import {useEffect,useState} from 'react';
import type {Active,Block,Language,Localized,Prep,Question,Sentence,Settings} from '../types';
import {languageLabels} from '../types';
import {fileUrl,post,RequestError,upload} from '../api';
import {Button} from './ui/button';
import {SettingsFields} from './SettingsForm';

const newId=()=>crypto.randomUUID();
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
const escapeText=(value:string)=>value.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
function move<T>(list:T[],index:number,step:number) {
  const next=list.slice(), target=index+step;
  if(target>=0&&target<list.length)[next[index],next[target]]=[next[target],next[index]];
  return next;
}
function orderControls(index:number,length:number,shift:(step:number)=>void) {
  return <span className="order-controls">
    <Button type="button" variant="ghost" disabled={!index} onClick={()=>shift(-1)}>위로</Button>
    <Button type="button" variant="ghost" disabled={index===length-1} onClick={()=>shift(1)}>아래로</Button>
  </span>;
}
function LanguageSelect({value,onChange,label}:{value:Language;onChange:(value:Language)=>void;label:string}) {
  return <label>{label}<select value={value} onChange={e=>onChange(e.target.value as Language)}>
    {Object.entries(languageLabels).map(([key,name])=><option key={key} value={key}>{name}</option>)}
  </select></label>;
}
function SentenceFields({value,explanation,onChange,editableLanguage=true}:{
  value:Sentence;explanation:Language;onChange:(value:Sentence)=>void;editableLanguage?:boolean;
}) {
  const optional=(key:'reading'|'translation',text:string)=>onChange({
    ...value,[key]:text?{text,language:value[key]?.language||explanation}:undefined,
  });
  const annotation=(key:'reading'|'translation',name:string)=>{
    const annotationValue:Localized|undefined=value[key];
    return <div className="field-grid" key={key}>
      <label>{name}<textarea value={annotationValue?.text||''} onChange={e=>optional(key,e.target.value)}/></label>
      {annotationValue&&<LanguageSelect label={name+' 언어'} value={annotationValue.language}
        onChange={language=>onChange({...value,[key]:{...annotationValue,language}})}/>}
    </div>;
  };
  return <>
    <label>원문<textarea value={value.text} onChange={e=>onChange({...value,text:e.target.value,rubyHtml:undefined})}/></label>
    {editableLanguage&&<LanguageSelect label="원문 언어" value={value.language} onChange={language=>onChange({...value,language})}/>}
    {annotation('reading','발음 표기')}{annotation('translation','번역')}
    {value.language==='ja'&&<label>루비 표기 (선택, ruby 태그)<textarea value={value.rubyHtml||''}
      onChange={e=>onChange({...value,rubyHtml:e.target.value||undefined})}/></label>}
  </>;
}
function QuestionFields({q,explanation,onChange}:{q:Question;explanation:Language;onChange:(q:Question)=>void}) {
  const answer=q.answer;
  return <>
    <label>질문 제목<input value={q.title} onChange={e=>onChange({...q,title:e.target.value})}/></label>
    <label>문항 상태<select value={q.status} onChange={e=>onChange({...q,status:e.target.value as Question['status']})}>
      <option value="needs_confirmation">확인 대기</option><option value="ready">연습 준비 완료</option><option value="archived">보관</option>
    </select></label>
    <fieldset><legend>질문</legend><SentenceFields value={q.promptStudy||q.prompt} explanation={explanation} onChange={value=>{
      const prompt={text:value.text,language:value.language};
      onChange({...q,prompt,promptStudy:value});
    }}/></fieldset>
    {answer.map((sentence,i)=><details className="editor-entry" key={i}>
      <summary>답안 {i+1} · {sentence.text.slice(0,58)}</summary>
      {orderControls(i,answer.length,step=>onChange({...q,answer:move(answer,i,step)}))}
      <Button variant="ghost" type="button" onClick={()=>onChange({...q,answer:answer.filter((_,index)=>index!==i)})}>이 문장 제거</Button>
      <SentenceFields value={sentence} explanation={explanation}
        onChange={value=>onChange({...q,answer:answer.map((s,index)=>index===i?value:s)})}/>
    </details>)}
    <Button type="button" variant="outline" onClick={()=>onChange({...q,answer:[...answer,{text:'',language:q.prompt.language}]})}>답안 문장 추가</Button>
    <label>평가 근거·사실 확인 (한 줄에 하나)<textarea defaultValue={q.referenceFacts.join('\n')}
      onBlur={e=>{const facts=lines(e.target.value);if(JSON.stringify(facts)!==JSON.stringify(q.referenceFacts))onChange({...q,referenceFacts:facts});}}/></label>
  </>;
}

function BlocksEditor({blocks,onChange,questions,onQuestion,explanation}:{
  blocks:Block[];onChange:(blocks:Block[])=>void;questions:Question[];onQuestion:(question:Question)=>void;explanation:Language;
}) {
  const replace=(index:number,next:Block)=>onChange(blocks.map((block,i)=>i===index?next:block));
  return <div className="blocks-editor">{blocks.map((block,index)=>{
    const q=block.type==='question'?questions.find(q=>q.id===block.questionId):undefined;
    return <details className="editor-entry" key={block.type==='question'?block.questionId:index}>
      <summary>{q?'질문 · '+q.title:block.type==='group'?'묶음 · '+block.title:'본문·참고 자료'}</summary>
      {orderControls(index,blocks.length,step=>onChange(move(blocks,index,step)))}
      {block.type==='html'&&<>
        <label>본문 HTML<textarea rows={7} value={block.html} onChange={e=>replace(index,{...block,html:e.target.value})}/></label>
        <Button variant="ghost" type="button" onClick={()=>onChange(blocks.filter((_,i)=>i!==index))}>이 본문 제거</Button>
      </>}
      {block.type==='group'&&<>
        <label>묶음 제목<input value={block.title} onChange={e=>replace(index,{...block,title:e.target.value})}/></label>
        <BlocksEditor blocks={block.blocks} onChange={items=>replace(index,{...block,blocks:items})}
          questions={questions} onQuestion={onQuestion} explanation={explanation}/>
      </>}
      {q&&<QuestionFields q={q} explanation={explanation} onChange={onQuestion}/>}
    </details>;
  })}</div>;
}

export function PrepEditor({active,onDirty,onClose,onSaved}:{active:Active;onDirty:(dirty:boolean)=>void;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [base,setBase]=useState(active.prep);
  const [draft,setDraft]=useState(()=>structuredClone(active.prep));
  const [sectionId,setSectionId]=useState(active.prep.sections[0]?.id||'');
  const [baseSettings,setBaseSettings]=useState<Settings>(active.manifest);
  const [settings,setSettings]=useState<Settings>(active.manifest);
  const [error,setError]=useState('');
  const [conflict,setConflict]=useState<{kind:'content';current:Prep}|{kind:'settings';current:Settings}|null>(null);
  const [busy,setBusy]=useState(false);
  const [asset,setAsset]=useState<File|null>(null);
  const [parentId,setParentId]=useState('');
  const dirty=JSON.stringify(draft)!==JSON.stringify(base)||JSON.stringify(settings)!==JSON.stringify(baseSettings);
  useEffect(()=>{onDirty(dirty);return ()=>onDirty(false);},[dirty,onDirty]);
  const section=draft.sections.find(s=>s.id===sectionId);
  const updateSection=(patch:Partial<Prep['sections'][number]>)=>setDraft(old=>({...old,sections:old.sections.map(s=>s.id===sectionId?{...s,...patch}:s)}));
  const scoped=<T,>(path:string,body:object)=>post<T>(path,{...body,mountId:active.mountId,requestId:crypto.randomUUID()});
  const execute=async(kind:'content'|'settings',fn:()=>Promise<void>)=>{
    setBusy(true);setError('');setConflict(null);
    try{await fn();await onSaved();}
    catch(error){
      setError((error as Error).message);
      if(error instanceof RequestError&&error.code==='EDIT_CONFLICT')setConflict(kind==='content'
        ?{kind,current:error.current as Prep}:{kind,current:error.current as Settings});
    }finally{setBusy(false);}
  };
  const addQuestion=()=>{
    if(!section)return;
    const id=newId();
    const parent=draft.questions.find(q=>q.id===parentId&&q.sectionId===section.id);
    const q:Question={id,sectionId:section.id,title:'새 질문',prompt:{text:'',language:settings.questionLanguage},
      answer:[],referenceFacts:[],version:1,status:'needs_confirmation',...(parent?{parentId:parent.id}:{})};
    const reference:Block={type:'question',questionId:id};
    const block:Block=parent?{type:'group',title:'후속 질문 · '+parent.title,blocks:[reference]}:reference;
    setDraft({...draft,questions:[...draft.questions,q],sections:draft.sections.map(s=>s.id===section.id?{...s,blocks:[...s.blocks,block]}:s)});
  };
  return <main className="prep-main editor-main"><div className="study">
    <div className="editor-toolbar"><div><p className="section-meta">Prep</p><h1>자료 편집</h1></div>
      <Button variant="outline" onClick={onClose}>학습 화면으로</Button></div>
    {error&&<p className="notice" role="alert">{error}</p>}
    {conflict&&<section className="conflict">
      <h2>저장 충돌 비교</h2>
      <div className="conflict-columns">
        <div><h3>현재 저장본</h3><pre>{JSON.stringify(conflict.current,null,2)}</pre></div>
        <div><h3>내 편집본</h3><pre>{JSON.stringify(conflict.kind==='content'?draft:settings,null,2)}</pre></div>
      </div>
      <Button variant="outline" onClick={()=>{
        if(conflict.kind==='content'){setBase(conflict.current);setDraft(conflict.current);setSectionId(conflict.current.sections[0]?.id||'');}
        else {setBaseSettings(conflict.current);setSettings(conflict.current);}
        setConflict(null);setError('');
      }}>저장본 불러오기</Button>
      <Button variant="outline" onClick={()=>{
        if(conflict.kind==='content')setBase(conflict.current);
        else setBaseSettings(conflict.current);
        setConflict(null);setError('비교한 내용을 확인한 뒤 저장 버튼으로 적용');
      }}>비교 후 내 편집본 유지</Button>
    </section>}
    <details className="editor-entry"><summary>면접 설정</summary>
      <form onSubmit={e=>{e.preventDefault();void execute('settings',async()=>{
        const saved=await scoped<Settings>('settings',{settings,expectedSettings:baseSettings});
        setBaseSettings(saved);setSettings(saved);
      });}}><SettingsFields value={settings} onChange={setSettings}/><Button type="submit" disabled={busy}>면접 설정 저장</Button></form>
    </details>
    <details className="editor-entry" open><summary>분류와 자료 순서</summary>
      {draft.categories.map((category,i)=><div className="editor-row" key={category.id}>
        <label>분류 이름<input value={category.title} onChange={e=>setDraft({...draft,categories:draft.categories.map(c=>c.id===category.id?{...c,title:e.target.value}:c)})}/></label>
        {orderControls(i,draft.categories.length,step=>setDraft({...draft,categories:move(draft.categories,i,step)}))}
      </div>)}
      <Button variant="outline" onClick={()=>setDraft({...draft,categories:[...draft.categories,{id:newId(),title:'새 분류'}]})}>분류 추가</Button>
      {draft.sections.map((s,i)=><div className="editor-row" key={s.id}>
        <Button variant={s.id===sectionId?'default':'ghost'} onClick={()=>{setSectionId(s.id);setParentId('');}}>{s.title}</Button>
        {orderControls(i,draft.sections.length,step=>setDraft({...draft,sections:move(draft.sections,i,step)}))}
      </div>)}
      <Button variant="outline" onClick={()=>{
        const category=draft.categories[0]||{id:newId(),title:'기본'};
        const id=newId();
        setDraft({...draft,categories:draft.categories.length?draft.categories:[category],
          sections:[...draft.sections,{id,title:'새 자료',categoryId:category.id,blocks:[],aliases:[]}]});
        setSectionId(id);setParentId('');
      }}>자료 추가</Button>
    </details>
    {section&&<section key={section.id}>
      <h2>{section.title}</h2>
      <div className="field-grid">
        <label>자료 제목<input value={section.title} onChange={e=>updateSection({title:e.target.value})}/></label>
        <label>분류<select value={section.categoryId} onChange={e=>updateSection({categoryId:e.target.value})}>
          {draft.categories.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="field-wide">검색 별칭 (|로 구분)<input defaultValue={section.aliases.join(' | ')}
          onBlur={e=>{const aliases=e.target.value.split('|').map(s=>s.trim()).filter(Boolean);if(JSON.stringify(aliases)!==JSON.stringify(section.aliases))updateSection({aliases});}}/></label>
      </div>
      <BlocksEditor blocks={section.blocks} onChange={blocks=>updateSection({blocks})} questions={draft.questions}
        onQuestion={q=>setDraft(old=>({...old,questions:old.questions.map(item=>item.id===q.id?q:item)}))} explanation={settings.explanationLanguage}/>
      <div className="editor-row">
        <Button variant="outline" onClick={()=>updateSection({blocks:[...section.blocks,{type:'html',html:'<p>새 본문</p>'}]})}>본문 추가</Button>
        <label>질문 종류<select value={parentId} onChange={e=>setParentId(e.target.value)}>
          <option value="">기본 질문</option>
          {draft.questions.filter(q=>q.sectionId===section.id&&q.status!=='archived').map(q=><option key={q.id} value={q.id}>{q.title}의 후속 질문</option>)}
        </select></label>
        <Button variant="outline" onClick={addQuestion}>질문 추가</Button>
      </div>
      <details className="editor-entry"><summary>첨부 자료</summary>
        {active.assets.map(name=><div className="editor-row" key={name}>
          <a href={fileUrl(active.mountId,name)} target="_blank" rel="noreferrer">{name}</a>
          <Button variant="ghost" onClick={()=>updateSection({blocks:[...section.blocks,{
            type:'html',html:'<p><a href="asset:'+encodeURIComponent(name)+'">'+escapeText(name)+'</a></p>',
          }]})}>본문에 링크 추가</Button>
        </div>)}
        <label>첨부 파일 (PDF·PNG·JPEG·WebP)<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>setAsset(e.target.files?.[0]||null)}/></label>
        <Button variant="outline" disabled={busy||!asset} onClick={()=>void execute('content',async()=>{
          if(asset)await upload('assets/'+active.mountId+'?name='+encodeURIComponent(asset.name),asset);
          setAsset(null);
        })}>첨부 올리기</Button>
      </details>
    </section>}
    <details className="editor-entry"><summary>연습 질문 순서</summary>
      {draft.questions.map((q,i)=><div key={q.id} className="editor-row"><span>{i+1}. {q.title}</span>
        {orderControls(i,draft.questions.length,step=>setDraft({...draft,questions:move(draft.questions,i,step)}))}</div>)}
    </details>
    <div className="editor-save"><Button disabled={busy||!!conflict} onClick={()=>void execute('content',async()=>{
      const saved=await scoped<Prep>('content',{content:draft,expectedVersion:base.version});
      setDraft(saved);setBase(saved);
    })}>Prep 자료 저장</Button><span className="small muted">{dirty?'저장되지 않은 변경':'저장된 자료 v'+base.version}</span></div>
  </div></main>;
}

