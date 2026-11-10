import {useMemo} from 'react';
import DOMPurify from 'dompurify';
import type {Prep, PrepSection, Question, Sentence, Attempt, Block} from '../types';
import {fileUrl} from '../api';
import {Button} from './ui/button';

export function SentenceView({value, originalOnly=false}:{value:Sentence;originalOnly?:boolean}) {
  const ruby = value.rubyHtml && DOMPurify.sanitize(value.rubyHtml, {ALLOWED_TAGS:['ruby','rt','rp'], ALLOWED_ATTR:[]});
  return <div className="study-sentence">
    <div className={value.language==='ja'?'jp':'answer-original'} lang={value.language}>
      {ruby ? <span dangerouslySetInnerHTML={{__html:ruby}}/> : value.text}
    </div>
    {!originalOnly&&value.reading&&<p className="reading" lang={value.reading.language}>{value.reading.text}</p>}
    {!originalOnly&&value.translation&&<p className="meaning" lang={value.translation.language}>{value.translation.text}</p>}
  </div>;
}

function QuestionAnswer({question, originalOnly}:{question:Question;originalOnly:boolean}) {
  if(question.status==='archived')return null;
  return <div id={'item-'+question.id}>
    <SentenceView value={question.promptStudy||question.prompt} originalOnly={originalOnly}/>
    {question.status==='needs_confirmation'&&<p className="notice">본인 사실 확인이 필요한 문항</p>}
    {question.answer.map((s,i)=><SentenceView value={s} key={i} originalOnly={originalOnly}/>)}
    {question.referenceFacts.map((fact,i)=><p className="study-note" key={i}>{fact}</p>)}
  </div>;
}

function Notes({html,mountId}:{html:string;mountId:string}) {
  const safe=useMemo(()=>{
    const doc=new DOMParser().parseFromString(DOMPurify.sanitize(html, {
      FORBID_TAGS:['img','iframe','form','input','button','style'],
      FORBID_ATTR:['src','srcset','style'],
    }),'text/html');
    doc.querySelectorAll('a').forEach(link=>{
      const asset=link.getAttribute('data-asset');
      const href=link.getAttribute('href')||'';
      if(asset)link.href=fileUrl(mountId,asset);
      else if(!/^(https?:\/\/|#)/i.test(href))link.removeAttribute('href');
      if(!href.startsWith('#')||asset) {
        link.target='_blank';
        link.rel='noopener noreferrer';
      }
    });
    return doc.body.innerHTML;
  },[html,mountId]);
  return <div className="note-block" dangerouslySetInnerHTML={{__html:safe}}/>;
}

function StudyBlocks({blocks,questions,mountId,originalOnly}:{blocks:Block[];questions:Map<string,Question>;mountId:string;originalOnly:boolean}) {
  return blocks.map((block,index)=>{
    if(block.type==='html')return <Notes key={index} html={block.html} mountId={mountId}/>;
    if(block.type==='group')return <details key={index} id={block.anchor}>
      <summary>{block.title}</summary><StudyBlocks blocks={block.blocks} questions={questions} mountId={mountId} originalOnly={originalOnly}/>
    </details>;
    const question=questions.get(block.questionId);
    return question&&<QuestionAnswer key={question.id} question={question} originalOnly={originalOnly}/>;
  });
}

function containsAnchor(blocks:Block[],id:string):boolean {
  return blocks.some(block=>block.type==='group' ? block.anchor===id||containsAnchor(block.blocks,id) :
    block.type==='html' ? block.html.includes('id="'+id+'"') : 'item-'+block.questionId===id);
}

export function Study({section,prep,mountId,originalOnly=false,onNavigate,onHistory,attempts=[]}:{
  section:PrepSection;prep:Prep;mountId:string;originalOnly?:boolean;onNavigate:(id:string)=>void;
  onHistory?:(id:string)=>void;attempts?:Attempt[];
}) {
  const questions=useMemo(()=>new Map(prep.questions.map(q=>[q.id,q])),[prep.questions]);
  return <article className={'study '+(originalOnly?'japanese-only':'')} onClick={event=>{
    const anchor=(event.target as HTMLElement).closest('a');
    const href=anchor?.getAttribute('href');
    if(!href?.startsWith('#')||href.length<2)return;
    const id=href.slice(1);
    const page=prep.sections.find(s=>s.id===id||containsAnchor(s.blocks,id));
    if(page){
      event.preventDefault();
      onNavigate(page.id);
      requestAnimationFrame(()=>{
        const element=document.getElementById(id);
        for(let parent=element?.closest('details');parent;parent=parent.parentElement?.closest('details')||null)parent.open=true;
        element?.scrollIntoView({block:'start'});
      });
    }
  }}>
    <div className="section-meta">{prep.categories.find(c=>c.id===section.categoryId)?.title}</div>
    <h1 id={section.id}>{section.title}</h1>
    {onHistory&&prep.questions.some(q=>q.sectionId===section.id)&&
      <Button variant="outline" onClick={()=>onHistory(section.id)}>내 답변 이력 {attempts.filter(a=>a.questionSnapshot.sectionId===section.id).length}개</Button>}
    <div className="imported"><StudyBlocks blocks={section.blocks} questions={questions} mountId={mountId} originalOnly={originalOnly}/></div>
  </article>;
}

export function QuestionStudy({question,onFullPrep}:{question:Question;onFullPrep:()=>void}) {
  return <article className="study question-hint">
    <div className="section-meta">지금 질문의 Prep 힌트</div><h1>{question.title}</h1>
    <QuestionAnswer question={question} originalOnly={false}/>
    {!question.answer.length&&<p className="notice">확인된 답안 보완 필요</p>}
    <Button variant="outline" onClick={onFullPrep}>전체 Prep 보기</Button>
  </article>;
}

