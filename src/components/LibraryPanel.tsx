import {useState} from 'react';
import type {Bootstrap,Manifest} from '../types';
import {initialSettings,languageLabels} from '../types';
import {post,upload} from '../api';
import {Button} from './ui/button';
import {SettingsFields} from './SettingsForm';

export function LibraryPanel({boot,onMount,onChanged,onClose}:{boot:Bootstrap;onMount:(id:string|null)=>Promise<void>;onChanged:()=>Promise<void>;onClose?:()=>void}) {
  const [settings,setSettings]=useState(initialSettings);
  const [create,setCreate]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const run=async(fn:()=>Promise<void>)=>{
    setBusy(true);setError('');setNotice('');
    try{await fn();}catch(error){setError((error as Error).message);}
    finally{setBusy(false);}
  };
  const last=boot.library.find(m=>m.interviewId===boot.lastInterviewId);
  return <main className="library-page">
    <div className="library-heading"><div><p className="section-meta">interview-rehearsal</p><h1>면접 자료 열기</h1>
      <p className="muted">면접별 자료와 연습 기록을 따로 보관. 한 번에 하나의 면접 사용.</p></div>
      {onClose&&<Button variant="outline" onClick={onClose}>현재 면접으로</Button>}
    </div>
    {error&&<p className="notice" role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    <div className="library-actions">
      {!boot.active&&last&&<Button disabled={busy} onClick={()=>void run(()=>onMount(last.interviewId))}>마지막 면접 열기</Button>}
      <Button variant="outline" onClick={()=>setCreate(!create)}>{create?'새 자료 입력 닫기':'새 자료 만들기'}</Button>
      {boot.active&&<Button variant="outline" disabled={busy} onClick={()=>void run(()=>onMount(null))}>현재 자료 닫기</Button>}
    </div>
    {create&&<form className="library-card" onSubmit={e=>{
      e.preventDefault();
      void run(async()=>{
        const manifest=await post<Manifest>('library',settings);
        setSettings(initialSettings);setCreate(false);
        await onChanged();await onMount(manifest.interviewId);
      });
    }}><h2>새 면접</h2><SettingsFields value={settings} onChange={setSettings}/><Button disabled={busy} type="submit">만들고 열기</Button></form>}
    <ul className="library-list">
      {boot.library.map(m=><li key={m.interviewId}>
        <div><strong>{m.title}</strong><p>{[m.company,m.role,languageLabels[m.questionLanguage]].filter(Boolean).join(' · ')}</p></div>
        {m.interviewId===boot.active?.manifest.interviewId
          ?<span className="small">사용 중</span>
          :<Button disabled={busy} variant="outline" onClick={()=>void run(()=>onMount(m.interviewId))} aria-label={m.title+' 열기'}>열기</Button>}
      </li>)}
    </ul>
    <form className="library-card" onSubmit={e=>{
      e.preventDefault();
      if(!file)return; const form=e.currentTarget;
      void run(async()=>{
        const result=await upload<Manifest>('import',file);
        await onChanged();setFile(null);form.reset();
        setNotice(result.title+' 가져오기 완료. 목록에서 열기 가능.');
      });
    }}>
      <h2>파일에서 가져오기</h2><label>면접 자료 파일 (.interviewpack)<input type="file" accept=".interviewpack,.zip" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
      <Button type="submit" variant="outline" disabled={busy||!file}>가져오기</Button>
    </form>
  </main>;
}
