import {readFileSync,writeFileSync,appendFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {contentSchema} from './content.mjs';
import {randomUUID} from 'node:crypto';

export class InterviewStore {
  constructor(directory,prep,onChange=()=>{}, {interviewId=null, contentPath=join(directory,'content.json'), language='ko'}={}) {
    this.interviewId=interviewId; this.contentPath=contentPath; this.language=language;
    this.directory=directory; this.prep=prep; this.onChange=onChange;
    mkdirSync(directory,{recursive:true});this.log=join(directory,'events.jsonl');
    this.state={sessions:[],messages:[],attempts:[],revisions:[],verification:{lastToolAt:null,voiceValidatedAt:null},sequence:0,interviewId};
    this.requests=new Set();this.utteranceReceipts=new Map();
    if(existsSync(this.log)) {
      const raw=readFileSync(this.log,'utf8');const lines=raw.split('\n');
      lines.forEach((line,i)=>{if(!line.trim())return;try{this.apply(JSON.parse(line));}catch(error){if(i!==lines.length-1)throw error;writeFileSync(this.log+'.interrupted',line);writeFileSync(this.log,lines.slice(0,i).join('\n')+'\n');}});
      if(!readFileSync(this.log,'utf8').endsWith('\n'))appendFileSync(this.log,'\n');
    }

  }
  apply(event) {
    if(event.interviewId!==this.interviewId || event.sequence!==this.state.sequence+1 || this.requests.has(event.requestId)) throw Error('기록 범위·순서 불일치');
    const p=event.payload;
    if(p.session){const i=this.state.sessions.findIndex(s=>s.id===p.session.id);if(i>=0)this.state.sessions.splice(i,1);this.state.sessions.push(p.session);}
    if(p.messages)this.state.messages.push(...p.messages);
    if(p.attempt){const i=this.state.attempts.findIndex(a=>a.id===p.attempt.id);if(i<0)this.state.attempts.push(p.attempt);else this.state.attempts[i]=p.attempt;}
    if(p.revision)this.state.revisions.push(p.revision);
    if(p.verification)Object.assign(this.state.verification,p.verification);
    if(event.type==="utterance.recorded")this.utteranceReceipts.set(event.requestId,{messageId:p.messages[0].id,attemptId:p.attempt?.id}); this.requests.add(event.requestId);this.state.sequence=event.sequence;
  }
  commit(type,payload,requestId) {
    if(!requestId)throw Error('requestId 필요');
    if(this.requests.has(requestId))return {duplicate:true,state:this.state};
    for (const item of [payload.session,payload.attempt,payload.revision,...(payload.messages||[])]) {
      if(item)item.interviewId=this.interviewId;
    }
    const event={id:randomUUID(),interviewId:this.interviewId,type,at:new Date().toISOString(),sequence:this.state.sequence+1,requestId,payload};
    appendFileSync(this.log,JSON.stringify(event)+'\n');this.apply(event);
    this.atomic('progress.json',this.state);this.onChange({type,sequence:event.sequence});return {state:this.state};
  }
  atomic(name,value){const path=join(this.directory,name);writeFileSync(path+'.tmp',JSON.stringify(value,null,2));renameSync(path+'.tmp',path);}
  session(id){const s=id?this.state.sessions.find(x=>x.id===id):this.state.sessions.at(-1);if(!s)throw Error('먼저 연습 시작 필요');return structuredClone(s);}
  question(id){const q=this.prep.questions.find(x=>x.id===id);if(!q)throw Error('질문을 찾을 수 없는 상태');return q;}
  context(sessionId){const s=sessionId?this.session(sessionId):this.state.sessions.at(-1);return {session:s||null,question:s?.currentQuestionId?this.question(s.currentQuestionId):null,verification:this.state.verification};}
  start({mode='resume',questionId,sessionId,requestId}) {
    if(this.requests.has(requestId))return {duplicate:true,...this.context()};
    const last=sessionId?this.state.sessions.find(s=>s.id===sessionId):this.state.sessions.at(-1);
    if(sessionId&&!last)throw Error('재개할 회차 없음');
    if(mode==='resume'&&last){const s=structuredClone(last);if(s.status==='paused')s.status=s.resumeStatus||'ready';this.commit('session.resumed',{session:s},requestId);return this.context();}
    const queue=mode==='review'?[this.question(questionId).id]:this.prep.questions.filter(q=>q.status!=='archived').map(q=>q.id);
    const s={id:randomUUID(),createdAt:new Date().toISOString(),kind:mode==='review'?'review':'interview',queue,askedIds:[],completed:{},currentQuestionId:null,failures:0,assisted:false,status:'ready',hintSectionId:null};
    this.commit('session.started',{session:s},requestId);return this.context();
  }
  next({sessionId,requestId}) {
    if(this.requests.has(requestId))return {duplicate:true,...this.context()};
    const s=this.session(sessionId);
    if(s.status==='paused')throw Error('중단 상태. 재개 전 새 질문 금지');
    if(!['ready','awaiting_next','completed'].includes(s.status))return {...this.context(),doNotRepeatQuestion:true};
    const available=this.prep.questions.filter(q=>q.status!=='archived').map(q=>q.id);
    if(s.kind==='interview'&&s.status!=='completed')s.queue.push(...available.filter(id=>!s.queue.includes(id)));
    const id=s.queue.find(id=>available.includes(id)&&!s.askedIds.includes(id));
    if(!id){s.status='completed';s.currentQuestionId=null;this.commit('session.completed',{session:s},requestId);return this.context();}
    s.currentQuestionId=id;s.presentedQuestion=structuredClone(this.question(id));s.askedIds.push(id);s.status='awaiting_answer';s.failures=0;s.assisted=false;s.hintSectionId=null;
    this.commit('question.presented',{session:s},requestId);
    return {...this.context(),action:'설정된 언어로 질문 한 개를 말하고, 실제 발화 문장을 record_utterance로 기록'};
  }
  utterance({sessionId,role,text,language=this.language,origin='codex_voice',intent='answer',kind='speech',requestId}) {
    if(this.requests.has(requestId))return {duplicate:true,...this.context(sessionId),...this.utteranceReceipts.get(requestId)};
    const s=this.session(sessionId);const now=new Date().toISOString();
    const message={id:randomUUID(),sessionId:s.id,questionId:s.currentQuestionId,role,text,language,origin,kind,at:now};
    const normalized=text.trim().replace(/[.!?。！？]/g,'').trim().toLowerCase();
    if(role==='user'){
      if(['그만해','면접 종료','stop','stop the interview','やめて','面接終了','面接をやめて'].includes(normalized))intent='stop';
      if(['몰라','모르겠어','모르겠어요','모르겠습니다',"i don't know",'i don’t know','わからない','分からない','分かりません','わかりません'].includes(normalized))intent='unknown';
      if(['도와줘','도와주세요','help','help me','助けて','手伝って'].includes(normalized))intent='help';
    }
    message.intent=role==='user'?intent:undefined;
    const payload={session:s,messages:[message]};let action=null;
    if(role==='user'&&intent==='stop'){if(s.status!=='paused')s.resumeStatus=s.status;s.status='paused';action='면접 중단. 추가 질문 금지. 음성 통화 자체 종료와 구분.';}
    else if(role==='user'&&s.currentQuestionId&&s.status!=='paused'){
      if(intent==='help'){s.assisted=true;s.status='awaiting_repeat';s.hintSectionId=this.question(s.currentQuestionId).sectionId;action='B 방식 교정: 오류 설명·면접 언어 교정문·한 번 따라 말하기';}
      else if(['answer','unknown'].includes(intent)){
        if(!['awaiting_answer','awaiting_repeat'].includes(s.status))throw Error('현재 답변의 판정 완료 후 다음 답변 접수 가능');
        const q=structuredClone(s.presentedQuestion || this.question(s.currentQuestionId));
        const a={id:randomUUID(),sessionId:s.id,questionId:q.id,questionVersion:q.version,questionSnapshot:q,number:this.state.attempts.filter(a=>a.sessionId===s.id&&a.questionId===q.id).length+1,kind:s.status==='awaiting_repeat'?'coaching_repeat':'answer',messageId:message.id,originalText:text,language,at:now,assistanceShown:s.assisted,evaluation:null};
        payload.attempt=a;
        if(intent==='unknown'){
          a.evaluation={code:'D',reason:'모름 표현에 따른 자료 힌트',errors:[],corrections:[],handling:'hint',referenceIds:[q.sectionId]};
          s.status='awaiting_answer';s.assisted=true;s.hintSectionId=q.sectionId;action=q.answer.length?'해당 Prep 문항을 확인하도록 안내':'자료 부족: upsert_question으로 확인된 내용의 학습 문항 보완 필요';
        }else{s.status='awaiting_evaluation';action='사실관계와 의미를 검토한 뒤 evaluate_answer 호출';}
      }
    }
    this.commit('utterance.recorded',payload,requestId);
    return {...this.context(),messageId:message.id,attemptId:payload.attempt?.id,action};
  }
  evaluate({attemptId,code,reason,satisfied=[],missing=[],errors=[],corrections=[],referenceIds=[],requestId}) {
    if(this.requests.has(requestId))return {duplicate:true,...this.context()};
    const a=structuredClone(this.state.attempts.find(x=>x.id===attemptId));
    if(!a)throw Error('답변 시도 없음');if(a.evaluation)throw Error('기존 판정 보존: 같은 답변 재판정 불가');
    const s=this.session(a.sessionId);if(s.status==='paused')throw Error('중단 상태. 재개 후 판정 필요');
    if(this.state.messages.some(m=>m.sessionId===a.sessionId&&m.questionId===a.questionId&&m.role==='assistant'&&['coaching','correction'].includes(m.kind)&&m.at<=a.at)){a.assistanceShown=true;s.assisted=true;}
    if(s.currentQuestionId!==a.questionId)throw Error('현재 질문과 다른 답변');
    if(errors.some(e=>e.type==='pronunciation'&&e.basis!=='heard_audio'))throw Error('발음 판정은 음성 직접 확인 필요. 전사 불확실성은 확인 요청으로 처리');
    let handling;
    if(a.kind==='coaching_repeat'&&code==='A'){handling='complete_coached';s.completed[a.questionId]='coached';s.status='awaiting_next';s.assisted=true;}
    else if(code==='A'){handling='next';s.completed[a.questionId]=s.assisted?'assisted_passed':'independent_passed';s.status='awaiting_next';}
    else if(code==='B'){handling='coaching';s.assisted=true;s.status='awaiting_repeat';}
    else if(code==='C'){
      s.failures++;handling=s.failures>=3?'coaching':s.failures===2?'hint_retry':'retry';
      s.status=s.failures>=3?'awaiting_repeat':'awaiting_answer';
      if(s.failures>=2){s.assisted=true;s.hintSectionId=this.question(a.questionId).sectionId;}
    }else{handling='hint';s.assisted=true;s.hintSectionId=this.question(a.questionId).sectionId;s.status='awaiting_answer';}
    a.evaluation={code,reason,satisfied,missing,errors,corrections,referenceIds,handling,at:new Date().toISOString()};
    this.commit('answer.evaluated',{session:s,attempt:a},requestId);
    return {...this.context(),evaluation:a.evaluation,action:handling};
  }
  pause({requestId,sessionId}){const s=this.session(sessionId);if(['paused','completed'].includes(s.status))return this.context(sessionId);s.resumeStatus=s.status;s.status='paused';this.commit('session.paused',{session:s},requestId);return this.context();}
  revise({messageId,text,reason,requestId}){if(!this.state.messages.some(x=>x.id===messageId))throw Error('발화 없음');return this.commit('transcript.revised',{revision:{id:randomUUID(),messageId,text,reason,at:new Date().toISOString()}},requestId);}
  saveContent(next, expectedVersion, requestId) {
    if(this.prep.lastEdit===requestId) return this.prep;
    if(expectedVersion!==this.prep.version) {
      throw Object.assign(Error('다른 곳에서 자료가 수정된 상태. 저장된 내용과 편집본을 비교한 뒤 재시도 필요'), {
        code:'EDIT_CONFLICT', status:409, details:{current:this.prep},
      });
    }
    const original=new Map(this.prep.questions.map(q=>[q.id,q]));
    const data=contentSchema.parse({
      ...next, lastEdit:requestId, version:this.prep.version+1,
      questions:next.questions.map(q=>({...q,version:original.get(q.id)?.version??1})),
    });
    const incoming=new Set(data.questions.map(q=>q.id));
    if(this.prep.questions.some(q=>!incoming.has(q.id))) throw Error('기록 보존을 위해 기존 질문은 보관 처리 필요');
    data.questions=data.questions.map(q=>{
      const previous=original.get(q.id);
      return previous&&JSON.stringify(previous)!==JSON.stringify(q)?{...q,version:previous.version+1}:q;
    });
    writeFileSync(this.contentPath+'.tmp',JSON.stringify(data,null,2));
    renameSync(this.contentPath+'.tmp',this.contentPath);
    this.prep=data;
    this.onChange({type:'prep.changed',sequence:this.state.sequence});
    return data;
  }
  upsert({question,expectedVersion,requestId}){
    if(this.prep.lastEdit===requestId)return {duplicate:true,question:this.question(question.id)};
    const draft=structuredClone(this.prep);
    const index=draft.questions.findIndex(q=>q.id===question.id);
    if(index<0) {
      const section=draft.sections.find(s=>s.id===question.sectionId);
      if(!section)throw Error('질문을 넣을 Prep 자료를 먼저 선택하거나 생성');
      const reference={type:'question',questionId:question.id};
      section.blocks.push(question.parentId?{type:'group',title:question.title,blocks:[reference]}:reference);
      draft.questions.push(question);
    } else {
      if(draft.questions[index].sectionId!==question.sectionId)throw Error('질문 이동은 Prep 편집기 사용');
      draft.questions[index]=question;
    }
    this.saveContent(draft,expectedVersion,requestId);
    return {question:this.question(question.id)};
  }
  verify({messageIds,confirmedByUser,requestId}){
    const messages=messageIds.map(id=>this.state.messages.find(m=>m.id===id)).filter(Boolean);
    if(!confirmedByUser||!['user','assistant'].every(role=>messages.some(m=>m.role===role&&m.origin==='codex_voice')))throw Error('실제 Codex Voice 양쪽 발화와 사용자 일치 확인 필요');
    return this.commit('voice.verified',{verification:{voiceValidatedAt:new Date().toISOString(),messageIds}},requestId);
  }
  exportCsv(){
    const cell=x=>'"'+String(x??'').replaceAll('"','""').replace(/^[=+@-]/,' $&')+'"';
    return '\ufeff'+[['interviewId','sessionId','questionId','questionVersion','attempt','kind','answer','code','reason','handling','correction','time'],...this.state.attempts.map(a=>[this.interviewId,a.sessionId,a.questionId,a.questionVersion,a.number,a.kind,a.originalText,a.evaluation?.code,a.evaluation?.reason,a.evaluation?.handling,JSON.stringify(a.evaluation?.corrections||[]),a.at])].map(row=>row.map(cell).join(',')).join('\r\n');
  }
}
