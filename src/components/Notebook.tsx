import {useState} from 'react';
import type {AppState,Attempt} from '../types';
import {Button} from './ui/button';
import {SentenceView} from './Study';
import {exportUrl} from '../api';
const labels:Record<string,string>={A:'통과',B:'표현 교정',C:'내용 재검토',D:'자료 힌트'};
export function Notebook({mountId,state,questionId,onReview,onClearQuestion}:{mountId:string;state:AppState;questionId:string|null;onReview:(id:string)=>void;onClearQuestion:()=>void}){
 const [code,setCode]=useState('all');const [error,setError]=useState('all');const [unfinished,setUnfinished]=useState(false);
 const attempts=state.attempts.filter(a=>(!questionId||a.questionSnapshot.sectionId===questionId||a.questionId===questionId)&&(code==='all'||a.evaluation?.code===code)&&(error==='all'||a.evaluation?.errors.some(e=>e.type===error))&&(!unfinished||!state.sessions.find(s=>s.id===a.sessionId)?.completed[a.questionId])).toReversed();
 const nextRepeat=(a:Attempt)=>state.attempts.find(x=>x.sessionId===a.sessionId&&x.questionId===a.questionId&&x.number>a.number&&x.kind==='coaching_repeat');
 return <div className="notebook"><div className="panel-heading"><div><h2>답변 기록·오답노트</h2><p>정답부터 교정 후 답변까지, 모든 시도 보관</p></div><a className="text-link" href={exportUrl(mountId,'json')} download>JSON</a><a className="text-link" href={exportUrl(mountId,'csv')} download>CSV</a></div>
  <div className="filters"><label>판정<select value={code} onChange={e=>setCode(e.target.value)}><option value="all">전체 A–D</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{k} · {v}</option>)}</select></label><label>오류<select value={error} onChange={e=>setError(e.target.value)}><option value="all">모든 유형</option><option value="fact">사실</option><option value="intent">질문 의도</option><option value="vocabulary">어휘</option><option value="grammar">문법</option><option value="pronunciation">발음</option></select></label><label className="checkbox"><input type="checkbox" checked={unfinished} onChange={e=>setUnfinished(e.target.checked)}/>미완료만</label></div>
  {questionId&&<Button variant="outline" onClick={onClearQuestion}>질문 필터 해제</Button>}
  <p className="small muted">{attempts.length}개 시도</p>
  {!attempts.length&&<div className="empty-inline"><h3>아직 표시할 답변 기록 없음</h3><p>Codex Voice에서 답변하면 원문과 판정이 이곳에 쌓이는 구성.</p></div>}
  {attempts.map(a=><details className="attempt" key={a.id}><summary><span className={'grade grade-'+(a.evaluation?.code||'pending')}>{a.evaluation?.code||'대기'}</span><span>{a.questionSnapshot.title}<small>{a.number}번째 · {a.kind==='coaching_repeat'?'따라 말하기':'내 답변'} · 자료 v{a.questionVersion}</small></span></summary>
   <div className="attempt-body"><p className="small muted">{new Date(a.at).toLocaleString('ko-KR')} · {a.assistanceShown?'힌트·교정 제공 후 답변':'도움 없이 답변'}</p><h4>내가 말한 답변</h4><p className="jp preserved">{a.originalText}</p>
    {state.revisions.filter(r=>r.messageId===a.messageId).map(r=><p className="revision" key={r.id}>전사 수정: {r.text}<small>{r.reason}</small></p>)}
    {a.evaluation&&<><h4>{a.evaluation.code} · {labels[a.evaluation.code]}</h4><p>{a.evaluation.reason}</p>{a.evaluation.handling==='coaching'&&a.evaluation.code==='C'&&<p className="notice">최초 판정 C 보존 · B 방식으로 교정 진행</p>}
     {!!a.evaluation.satisfied?.length&&<p>충족: {a.evaluation.satisfied.join(' · ')}</p>}{!!a.evaluation.missing?.length&&<p>보완: {a.evaluation.missing.join(' · ')}</p>}
     {a.evaluation.errors.map((e,i)=><div className="error-row" key={i}><p>{e.original} → <strong>{e.correct}</strong></p><p>{e.explanation}</p><small>{e.type==='pronunciation'?'음성 직접 확인 근거':'문장·사실 검토'}</small></div>)}
     {a.evaluation.corrections.length>0&&<h4>교정 문장</h4>}{a.evaluation.corrections.map((s,i)=><SentenceView key={i} value={s}/>)}
     {!!a.evaluation.referenceIds?.length&&<p className="small">참고 문항: {a.evaluation.referenceIds.join(', ')}</p>}</>}
    {nextRepeat(a)&&<><h4>다시 말한 답변</h4><p className="jp">{nextRepeat(a)!.originalText}</p></>}
    <p className="small">결과: {({independent_passed:'독립 통과',assisted_passed:'도움 후 통과',coached:'교정 후 연습 완료'} as Record<string,string>)[state.sessions.find(s=>s.id===a.sessionId)?.completed[a.questionId]||'']||'미완료'}</p>
    <Button variant="outline" onClick={()=>onReview(a.questionId)}>이 질문 다시 연습</Button>
   </div></details>)}
 </div>;
}
