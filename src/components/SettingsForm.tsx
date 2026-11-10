import type {Language,Settings} from '../types';
import {languageLabels} from '../types';

export function SettingsFields({value,onChange}:{value:Settings;onChange:(value:Settings)=>void}) {
  return <div className="field-grid">
    <label>면접 이름<input required value={value.title} onChange={e=>onChange({...value,title:e.target.value})}/></label>
    <label>회사<input value={value.company} onChange={e=>onChange({...value,company:e.target.value})}/></label>
    <label>직무<input value={value.role} onChange={e=>onChange({...value,role:e.target.value})}/></label>
    <label>질문 언어<select value={value.questionLanguage} onChange={e=>onChange({...value,questionLanguage:e.target.value as Language})}>
      {Object.entries(languageLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}
    </select></label>
    <label>설명 언어<select value={value.explanationLanguage} onChange={e=>onChange({...value,explanationLanguage:e.target.value as Language})}>
      {Object.entries(languageLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}
    </select></label>
    <label className="field-wide">말하기 메모<textarea value={value.speakingNotes} onChange={e=>onChange({...value,speakingNotes:e.target.value})}/></label>
  </div>;
}
