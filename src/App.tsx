import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,MessageCircle,Search,ArrowUpRight,Pause,Play,NotebookPen,PanelRightClose,Copy} from 'lucide-react';
import type {Active,Block,Bootstrap} from './types';
import {languageLabels} from './types';
import {exportUrl,post,request} from './api';
import {LibraryPanel} from './components/LibraryPanel';
import {PrepEditor} from './components/PrepEditor';
import {Button} from './components/ui/button';
import {Study,QuestionStudy} from './components/Study';
import {Notebook} from './components/Notebook';
import './interview.css';

const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[^\p{L}\p{N}]/gu,'');
const statuses:Record<string,string>={ready:'시작 준비',awaiting_answer:'답변 대기',awaiting_evaluation:'검토 대기',awaiting_repeat:'교정 따라 말하기',awaiting_next:'다음 질문 준비',paused:'연습 중단',completed:'연습 완료'};
function readBlocks(blocks:Block[]):string {
  return blocks.map(block=>block.type==='group'?block.title+' '+readBlocks(block.blocks):
    block.type==='html'?block.html.replace(/<[^>]*>/g,' '):'').join(' ');
}

export default function App() {
  const [boot,setBoot]=useState<Bootstrap|null>(null);
  const [online,setOnline]=useState(false);
  const [showLibrary,setShowLibrary]=useState(false);
  const [error,setError]=useState('');
  const latest=useRef(0);
  const mounted=useRef<string|null>(null);
  const refresh=useCallback(async()=>{
    const ticket=++latest.current;
    try{
      const next=await request<Bootstrap>('bootstrap');
      if(ticket!==latest.current)return;
      mounted.current=next.active?.mountId||null;
      setBoot(next);setOnline(true);setError('');
    }catch{
      if(ticket!==latest.current)return;
      setOnline(false);setError('로컬 서버 연결 확인 필요');
    }
  },[]);
  useEffect(()=>{
    const events=new EventSource('/api/events');
    events.onmessage=event=>{
      const data=JSON.parse(event.data);
      if(data.mountId!==mounted.current){
        mounted.current=data.mountId;
        setBoot(previous=>previous&&{...previous,active:null});
      }
      void refresh();
    };
    events.onerror=()=>{
      ++latest.current;
      setOnline(false);setError('로컬 서버 재연결 중');
    };
    return ()=>{events.close();};
  },[refresh]);
  const changeMount=async(interviewId:string|null)=>{
    await post('mount',{interviewId,expectedMountId:boot?.active?.mountId??null});
    await refresh();
    setShowLibrary(false);
  };
  if(!boot)return <main className="library-page"><h1>interview-rehearsal</h1><p role="status">{error||'로컬 자료 확인 중'}</p></main>;
  if(!boot.active||showLibrary){
    if(!online)return <main className="library-page"><h1>interview-rehearsal</h1><p role="status">{error}</p></main>;
    return <LibraryPanel boot={boot} onMount={changeMount} onChanged={refresh}
      onClose={boot.active?()=>setShowLibrary(false):undefined}/>;
  }
  return <>
    {!online&&<main className="library-page"><h1>interview-rehearsal</h1><p role="status">{error}</p></main>}
    <div hidden={!online}>
      <Interview key={boot.active.mountId} active={boot.active} connectCommand={boot.connectCommand}
        refresh={refresh} openLibrary={()=>setShowLibrary(true)}/>
    </div>
  </>;
}

function Interview({active,connectCommand,refresh,openLibrary}:{
  active:Active;connectCommand:string;refresh:()=>Promise<void>;openLibrary:()=>void;
}) {
 const [error,setError]=useState('');
 const [mode,setMode]=useState<'prep'|'chat'>('prep');
 const [sectionId,setSectionId]=useState(active.prep.sections[0]?.id||'');
 const [query,setQuery]=useState('');
 const [jpOnly,setJpOnly]=useState(false);
 const [panel,setPanel]=useState<'notes'|'hint'|null>('notes');
 const [historyQuestion,setHistoryQuestion]=useState<string|null>(null);
 const [editing,setEditing]=useState<string|null>(null);
 const [editText,setEditText]=useState('');
 const [editReason,setEditReason]=useState('');
 const lastHint=useRef<string|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const chatEnd=useRef<HTMLDivElement>(null);
 const chatScroll=useRef<HTMLDivElement>(null);
 const followBottom=useRef(true);
 const [editor,setEditor]=useState(false);
 const [dirty,setDirty]=useState(false);
 const [includeHistory,setIncludeHistory]=useState(false);
 const online=true;
 const {prep,state,manifest,mountId}=active;
 const leaveEditor=()=>!dirty||window.confirm('저장하지 않은 편집을 버리시겠습니까?');
 const hint=state.sessions.at(-1)?.hintSectionId||null;
 useEffect(()=>{
   if(hint&&hint!==lastHint.current)setPanel('hint');
   lastHint.current=hint;
 },[hint]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setEditing(null);if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();input.current?.focus();input.current?.select();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
 const session=state.sessions.at(-1);const current=prep.questions.find(q=>q.id===session?.currentQuestionId);
 useEffect(()=>{if(followBottom.current)chatEnd.current?.scrollIntoView({block:'end'});},[state.messages.length]);
 const section=prep.sections.find(s=>s.id===sectionId)||prep.sections[0];
 const groups=prep.categories;
 const categoryTitle=(id:string)=>groups.find(g=>g.id===id)?.title||'';
 const results=useMemo(()=>{
  const q=normalize(query);if(!q)return [];
  const terms=query.split(/\s+/).map(normalize).filter(Boolean);
  return prep.sections.map(section=>{
    const questions=prep.questions.filter(item=>item.sectionId===section.id&&item.status!=='archived');
    const body=[section.title,readBlocks(section.blocks),...section.aliases,...questions.flatMap(item=>[
      item.title,item.prompt.text,item.promptStudy?.reading?.text,item.promptStudy?.translation?.text,
      ...item.answer.flatMap(s=>[s.text,s.reading?.text,s.translation?.text,s.rubyHtml?.replace(/<[^>]*>/g,' ')]),
      ...item.referenceFacts,
    ])].filter(Boolean).join(' ');
    const content=normalize(body);
    const title=normalize(section.title);
    const alias=section.aliases.some(alias=>q.includes(normalize(alias)));
    const score=alias?200:title.includes(q)?140:content.includes(q)?100:terms.every(term=>content.includes(term))?85:0;
    const offset=Math.max(0,body.toLowerCase().indexOf(query.toLowerCase())-40);
    return {section,score,snippet:body.slice(offset,offset+180)};
  }).filter(result=>result.score).sort((a,b)=>b.score-a.score);
 },[query,prep]);
 const action=async(path:string,body:Record<string,unknown>)=>{
   setError('');
   try{await post(path,{...body,mountId,requestId:crypto.randomUUID()});await refresh();return true;}
   catch(error){setError((error as Error).message);return false;}
 };
 const navigate=(id:string)=>{setSectionId(id);setQuery('');document.querySelector('.prep-main')?.scrollTo({top:0});};
 const review=async(id:string)=>{if(await action('session',{mode:'review',questionId:id})){setMode('chat');setHistoryQuestion(null);}};
 const hintId=session?.hintSectionId||current?.sectionId;const hintSection=prep.sections.find(s=>s.id===hintId);
 const voiceVerified=!!state.verification.voiceValidatedAt;
 const messages=state.messages.filter(m=>m.sessionId===session?.id);
 const [prepCopyStatus,setPrepCopyStatus]=useState<'idle'|'copied'|'manual'>('idle');
 const prepPrompt=[
   'Prepare interview materials in interview-rehearsal using text only. Reply to me in Korean.',
   'Interview: '+JSON.stringify(manifest.title),
   'Company: '+JSON.stringify(manifest.company || '(not specified)'),
   'Role: '+JSON.stringify(manifest.role || '(not specified)'),
   '',
   'Use the interview-rehearsal project folder as your working directory. In this fresh Codex chat, run:',
   connectCommand+' '+manifest.interviewId,
   'Use the returned connectionId with interactive-interview. Confirm the interview with get_context before writing. If the connection fails or the interview differs, stop and tell me.',
   '',
   'Use the interview language settings. Ask me for the job posting, interview stage, and relevant experience if needed. Draft likely questions, sample answers, and follow-ups based on the facts I provide. Mark unconfirmed facts for review.',
   'Read the existing Prep with get_prep before editing. Save the draft with save_prep using the current content version and preserve existing material. Tell me what you added and what needs my input.',
 ].join('\n');
 const copyPrepPrompt=async()=>{
   try {
     await navigator.clipboard.writeText(prepPrompt);
     setPrepCopyStatus('copied');
   } catch {
     setPrepCopyStatus('manual');
   }
 };
 const voicePrompt=[
   'interactive-interview로 현재 면접의 연습 시작. 기존에 다른 면접을 다룬 대화라면 이 요청을 중단하고 빈 새 Codex 대화로 안내.',
   '현재 Codex 대화에서 다음 명령 실행: '+connectCommand,
   '발급된 connectionId를 interactive-interview 호출에 사용. get_context로 면접과 회차 확인 후 start_session으로 재개.',
   '질문은 '+languageLabels[manifest.questionLanguage]+', 교정 설명은 '+languageLabels[manifest.explanationLanguage]+'. 한 번에 한 질문씩 진행.',
   '답변 완료까지 기다린 뒤 실제 발화 기록과 ABCD 평가. 확정된 질문·답안 수정은 Prep에도 반영. 실제 음성 전달 검증은 사용자 확인 후에만 진행.',
 ].join('\n');
 return <div className="app-shell"><header className="topbar"><a className="brand" href="#" onClick={e=>{e.preventDefault();if(leaveEditor()){setEditor(false);setMode('prep');navigate(prep.sections[0]?.id||'');}}}><span className="brand-mark">i</span><span>interview-rehearsal<small>{manifest.title}</small></span></a><nav className="mode-tabs" aria-label="앱 모드"><button className={mode==='prep'?'active':''} onClick={()=>setMode('prep')}><BookOpen size={17}/>Prep</button><button className={mode==='chat'?'active':''} onClick={()=>{if(leaveEditor()){setEditor(false);setMode('chat');}}}><MessageCircle size={17}/>Chat</button></nav><Button className="mount-button" variant="outline" onClick={()=>{if(leaveEditor())openLibrary();}}>자료 교체</Button></header>
 {!editor&&<div className="global-search"><Search size={18}/><input ref={input} aria-label="면접 자료 전체 검색" value={query} onChange={e=>{setQuery(e.target.value);if(e.target.value)setMode('prep');}} placeholder="질문, 기술, 한글 발음으로 검색"/><kbd>Ctrl K</kbd>{query&&<button onClick={()=>setQuery('')}>지우기</button>}</div>}
 {error&&<div role="alert" className="notice global-error">{error}<button onClick={()=>setError('')}>닫기</button></div>}
 {editor?<PrepEditor active={active} onDirty={setDirty} onSaved={refresh} onClose={()=>{if(leaveEditor())setEditor(false);}}/>:mode==='prep'?<div className="prep-layout"><aside className="sidebar"><p className="sidebar-heading">학습 자료</p>{groups.map(group=><div className="nav-group" key={group.id}><h2>{group.title}</h2>{prep.sections.filter(s=>s.categoryId===group.id).map(s=><button key={s.id} className={sectionId===s.id&&!query?'selected':''} onClick={()=>navigate(s.id)}>{s.title.replace(/ — .*/, '')}</button>)}</div>)}<div className="sidebar-footer">{prep.questions.filter(q=>q.status!=='archived').length}개 문항<br/>자료 v{prep.version}</div></aside><main className="prep-main"><div className="reading-toolbar"><span>Prep · {query?`${results.length}개 검색 결과`:section?categoryTitle(section.categoryId):'자료 준비'}</span><div className="prep-tools"><button onClick={()=>void copyPrepPrompt()}>Codex 시작 문구 복사</button><span role="status">{prepCopyStatus==='copied'?'복사 완료 · 새 Codex 대화에 붙여 넣기':''}</span><button onClick={()=>setEditor(true)}>자료 편집</button><button aria-pressed={jpOnly} onClick={()=>setJpOnly(!jpOnly)}>{jpOnly?'발음·해석 함께 보기':'원문만 보기'}</button><details><summary>내보내기</summary><a href={exportUrl(mountId,'html')} download>Prep HTML</a><label><input type="checkbox" checked={includeHistory} onChange={e=>setIncludeHistory(e.target.checked)}/>연습 기록 포함</label><a href={exportUrl(mountId,'pack')+(includeHistory?'?history=1':'')} download>면접 자료 파일</a></details></div></div>
 {prepCopyStatus==='manual'&&<div className="study">
   <label htmlFor="prep-prompt">자동 복사 실패 · 아래 문구를 직접 복사</label>
   <textarea id="prep-prompt" className="w-full" rows={8} readOnly value={prepPrompt} onFocus={event=>event.currentTarget.select()}/>
 </div>}
 {query?<div className="search-list"><h1>“{query}” 검색</h1>{!results.length&&<p>일치하는 자료 없음. 핵심 단어로 다시 검색.</p>}{results.map(({section:s,snippet})=><button key={s.id} onClick={()=>navigate(s.id)}><span>{categoryTitle(s.categoryId)}</span><h2>{s.title}<ArrowUpRight size={18}/></h2><p>{snippet}</p></button>)}</div>:section?<Study section={section} prep={prep} mountId={mountId} originalOnly={jpOnly} onNavigate={navigate} attempts={state.attempts} onHistory={id=>{setHistoryQuestion(id);setPanel('notes');setMode('chat');}}/>:<div className="study"><h1>이 면접의 자료 준비</h1><p>Codex로 자료를 작성하거나 앱에서 질문과 답안 추가.</p><Button onClick={()=>setEditor(true)}>자료 편집</Button></div>}
 </main></div>:<div className={'chat-layout '+(!panel?'no-panel':'')}><main className="chat-main"><div className="chat-heading"><div><h1>{manifest.title} · Chat</h1><p>{session?`${Object.keys(session.completed).length} / ${session.queue.length} 완료 · ${statuses[session.status]}`:languageLabels[manifest.questionLanguage]+' 질문 · '+languageLabels[manifest.explanationLanguage]+' 설명'}</p></div><Button variant="outline" onClick={()=>setPanel(panel?null:'notes')}><NotebookPen size={17}/>답변 기록</Button></div>
 <div className={'voice-state '+(voiceVerified?'verified':'')}><strong>{voiceVerified?'실제 Voice 전달 확인':'Voice 자동 전달 미검증'}</strong><span>{state.verification.lastToolAt?'Codex 도구 연결 기록 확인 · 실제 음성 대조는 별도':'음성은 Codex에서 진행 · 앱은 대화와 교정 기록 표시'}</span></div>
 <div className="chat-controls"><Button disabled={!online} onClick={()=>void action('session',{mode:session?'resume':'new'})}><Play size={15}/>{session?'이어하기':'연습 준비'}</Button><Button variant="outline" disabled={!online||session?.status==='paused'||!session} onClick={()=>void action('pause',{})}><Pause size={15}/>중단</Button><Button variant="outline" disabled={!online} onClick={()=>void action('session',{mode:'new'})}>새 회차</Button>{hintSection&&<Button variant="outline" onClick={()=>setPanel('hint')}>관련 Prep</Button>}</div>
 <details className="voice-launch" open><summary>Voice 시작 문구 · 읽기와 복사</summary><p>이 Codex 대화에서 Voice를 직접 켠 뒤 아래 문구를 말하거나, Voice가 켜진 상태에서 붙여 넣기. 앱의 이어하기·복사 버튼은 Voice 통화를 켜는 기능과 별개.</p><textarea aria-label="Voice 시작 문구" readOnly value={voicePrompt}/><Button variant="outline" onClick={()=>void navigator.clipboard.writeText(voicePrompt)}><Copy size={15}/>Voice 시작 문구 복사</Button></details>
 <div className="chat-scroll" ref={chatScroll} onScroll={()=>{const e=chatScroll.current;if(e)followBottom.current=e.scrollHeight-e.scrollTop-e.clientHeight<100;}}>
 {!messages.length&&<div className="chat-empty"><span className="empty-icon"><MessageCircle size={30}/></span><h2>말하면서 연습할 준비</h2><p>Codex에서 Voice를 켠 뒤 면접 연습을 시작.<br/>음성 전달이 확인되면 이곳에 양쪽 대화 표시.</p><Button variant="outline" onClick={()=>void navigator.clipboard.writeText(voicePrompt)}><Copy size={15}/>Codex 시작 문구 복사</Button><details className="setup-details"><summary>연결 확인 방법</summary><p>로컬 연결 주소: http://127.0.0.1:4173/mcp</p><p>Codex의 interactive-interview 도구가 보이지 않으면 도구 연결 새로고침 또는 앱 재시작 후 같은 대화에서 Voice 시작.</p><p>시험용 데이터는 실제 Voice 확인으로 처리하지 않는 기준.</p></details></div>}
 {messages.map(m=>{const rev=state.revisions.filter(r=>r.messageId===m.id).at(-1);return <div className={'message-row '+m.role} key={m.id}><div className="bubble"><div className="bubble-text" lang={m.language}>{rev?.text||m.text}</div><div className="bubble-meta">{m.role==='assistant'?'Codex':'나'} · {new Date(m.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}{rev&&' · 전사 수정'}<button onClick={()=>{setEditing(m.id);setEditText(rev?.text||m.text);setEditReason('');}}>전사 수정</button></div></div></div>;})}<div ref={chatEnd}/></div>
 <footer className="chat-footer"><span>{current?current.title:'대화 기록은 이 컴퓨터에 보관'}</span><small>‘그만해’ 전체 중단 · ‘도와줘’ 교정 · ‘몰라’ 자료 힌트</small></footer>
 </main>{panel&&<aside className="chat-panel"><div className="panel-tabs"><button className={panel==='notes'?'selected':''} onClick={()=>setPanel('notes')}>답변 기록</button><button className={panel==='hint'?'selected':''} disabled={!hintSection} onClick={()=>setPanel('hint')}>Prep 힌트</button><button className="icon-button" aria-label="옆 패널 닫기" onClick={()=>setPanel(null)}><PanelRightClose size={18}/></button></div>{panel==='notes'?<Notebook mountId={mountId} state={state} questionId={historyQuestion} onClearQuestion={()=>setHistoryQuestion(null)} onReview={id=>void review(id)}/>:hintSection&&(current?<QuestionStudy question={current} onFullPrep={()=>{navigate(current.sectionId);setMode('prep');}}/>:<Study section={hintSection} prep={prep} mountId={mountId} onNavigate={id=>{navigate(id);setMode('prep');}}/>)}</aside>}</div>}
 {editing&&<div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="전사 수정" className="edit-dialog"><h2>전사 수정</h2><p>원래 기록은 보관하고 수정본을 별도로 추가.</p><label>수정한 내용<textarea value={editText} onChange={e=>setEditText(e.target.value)}/></label><label>수정 이유<input value={editReason} onChange={e=>setEditReason(e.target.value)}/></label><div><Button variant="outline" onClick={()=>setEditing(null)}>취소</Button><Button disabled={!editText.trim()||!editReason.trim()} onClick={async()=>{if(await action('transcript-revision',{messageId:editing,text:editText,reason:editReason}))setEditing(null);}}>수정본 저장</Button></div></section></div>}
 </div>;
}
