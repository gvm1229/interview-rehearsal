import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {InterviewStore} from '../server/store.mjs';
const prep=()=>({
 version:1,categories:[{id:'practice',title:'연습'}],
 sections:['intro','role'].map(id=>({id,title:id,categoryId:'practice',blocks:[{type:'question',questionId:id}]})),
 questions:['intro','role'].map(id=>({
  id,sectionId:id,title:id,prompt:{text:'自己紹介をお願いします。',language:'ja'},
  answer:[{text:'開発者です。',language:'ja',translation:{text:'개발자 소개',language:'ko'}}],
  referenceFacts:['개발 경험'],version:1,status:'ready',
 })),
});
const create=()=>{const dir=mkdtempSync(join(tmpdir(),'interview-store-test-'));return {dir,store:new InterviewStore(dir,prep())};};
const req=()=>({requestId:randomUUID()});
test('읽기 안내 후 답변은 독립 통과 대신 도움 후 통과',()=>{const {store}=create();begin(store);store.utterance({...req(),role:'assistant',text:'자료를 보고 연습',origin:'protocol_test',kind:'coaching'});grade(store,answer(store),'A');assert.equal(store.session().completed.intro,'assisted_passed');assert.equal(store.state.attempts[0].assistanceShown,true);});
test('따라 말하기에서도 B·C·D는 완료 없이 교정·재시도 유지',()=>{
 for(const code of ['B','C','D']){const {store}=create();begin(store);grade(store,answer(store),'B');grade(store,answer(store),code);assert.equal(store.session().completed.intro,undefined);assert.notEqual(store.session().status,'awaiting_next');assert(store.next(req()).doNotRepeatQuestion);}
});
function begin(store){store.start({...req(),mode:'new'});store.next(req());}
function answer(store,text='テスト回答',intent='answer'){return store.utterance({...req(),role:'user',text,intent,origin:'protocol_test'}).attemptId;}
function grade(store,attemptId,code){return store.evaluate({...req(),attemptId,code,reason:'검증용 판정',corrections:[{text:'開発者です。',language:'ja',translation:{text:'교정 예시',language:'ko'}}]});}

test('C → C → C는 각각 보존, 세 번째는 B 방식 교정, 따라 말하기는 도움 후 완료',()=>{
 const {store}=create();begin(store);
 const ids=[];for(let i=1;i<=3;i++){const id=answer(store,'답변 '+i);ids.push(id);const r=grade(store,id,'C');assert.equal(r.evaluation.handling,i===1?'retry':i===2?'hint_retry':'coaching');}
 assert.equal(store.session().failures,3);assert.equal(store.session().status,'awaiting_repeat');
 const repeat=answer(store,'교정 후 다시 말한 답변');grade(store,repeat,'A');
 assert.deepEqual(store.state.attempts.map(a=>a.evaluation.code),['C','C','C','A']);
 assert.equal(store.state.attempts[3].kind,'coaching_repeat');assert.equal(store.session().completed.intro,'coached');
 assert.deepEqual(store.state.attempts.slice(0,3).map(a=>a.originalText),['답변 1','답변 2','답변 3']);
 store.next(req());assert.equal(store.session().currentQuestionId,'role');
});
test('B 뒤 따라 말하기·독립 A 구분',()=>{const {store}=create();begin(store);grade(store,answer(store),'B');assert.equal(store.session().status,'awaiting_repeat');grade(store,answer(store),'A');assert.equal(store.session().completed.intro,'coached');store.next(req());grade(store,answer(store),'A');assert.equal(store.session().completed.role,'independent_passed');});
test('세 언어 모름은 D, 오답 횟수 증가 없음, 인용된 모름은 명령 아님',()=>{
 for(const text of ['몰라',"I don't know",'分かりません']){const {store}=create();begin(store);answer(store,text);assert.equal(store.state.attempts[0].evaluation.code,'D');assert.equal(store.session().failures,0);assert.equal(store.session().hintSectionId,'intro');}
 const {store}=create();begin(store);answer(store,'分からないときは、資料を読みます。');assert.equal(store.state.attempts[0].evaluation,null);
});
test('도움·중단은 제어 기록, 재개해도 질문 재출제 없음',()=>{const {dir,store}=create();begin(store);answer(store,'도와줘');assert.equal(store.state.attempts.length,0);assert.equal(store.session().status,'awaiting_repeat');answer(store,'그만해');assert.equal(store.session().status,'paused');assert.throws(()=>store.next(req()));const loaded=new InterviewStore(dir,prep());loaded.start({...req(),mode:'resume'});const r=loaded.next(req());assert(r.doNotRepeatQuestion);assert.deepEqual(loaded.session().askedIds,['intro']);});
test('재시도 요청 중복 제거·원문 보존 전사 수정·과거 질문 버전 보존·CSV',()=>{
 const {dir,store}=create();begin(store);const command={...req(),role:'user',text:'=테스트 답변',origin:'protocol_test'};const a=store.utterance(command);store.utterance(command);assert.equal(store.state.messages.length,1);
 store.revise({...req(),messageId:a.messageId,text:'수정 전사',reason:'인식 오류'});assert.equal(store.state.messages[0].text,'=테스트 답변');assert.equal(store.state.revisions.length,1);
 const original=structuredClone(store.question('intro'));store.upsert({...req(),expectedVersion:1,question:{...original,prompt:{...original.prompt,text:'新しい質問です。'}}});assert.equal(store.state.attempts[0].questionVersion,1);assert.equal(store.state.attempts[0].questionSnapshot.prompt.text,'自己紹介をお願いします。');assert.equal(store.question('intro').version,2);
 assert(store.prep.sections.some(s=>s.id==='intro'));assert(store.exportCsv().includes(' =테스트 답변'));const loaded=new InterviewStore(dir,JSON.parse(readFileSync(join(dir,'content.json'),'utf8')));assert.equal(loaded.state.messages.length,1);assert.equal(loaded.question('intro').version,2);
});
test('불완전한 마지막 로그 복구 후 새 기록도 다시 읽기 가능',()=>{const {dir,store}=create();begin(store);appendFileSync(join(dir,'events.jsonl'),'{"partial":');const loaded=new InterviewStore(dir,prep());answer(loaded);const again=new InterviewStore(dir,prep());assert.equal(again.state.attempts.length,1);assert(readFileSync(join(dir,'events.jsonl.interrupted'),'utf8').includes('partial'));});
test('전사만으로 발음 오류 확정 금지·시험 문구를 Voice 검증으로 사용 금지',()=>{const {store}=create();begin(store);const a=answer(store);assert.throws(()=>store.evaluate({...req(),attemptId:a,code:'B',reason:'발음',errors:[{type:'pronunciation',basis:'transcript_uncertain'}]}),/음성 직접/);const m=store.utterance({...req(),role:'assistant',text:'시험 문구',origin:'protocol_test'});assert.throws(()=>store.verify({...req(),messageIds:[store.state.messages[0].id,m.messageId],confirmedByUser:true}));assert.equal(store.state.verification.voiceValidatedAt,null);});
