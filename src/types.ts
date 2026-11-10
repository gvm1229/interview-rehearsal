export type Language = 'ko' | 'ja' | 'en';
export type Localized = {text:string;language:Language};
export type Sentence = Localized & {reading?:Localized;translation?:Localized;rubyHtml?:string};
export type Block = {type:'html';html:string} | {type:'question';questionId:string} |
  {type:'group';title:string;anchor?:string;blocks:Block[]};
export type PrepSection = {id:string;title:string;categoryId:string;blocks:Block[];aliases:string[]};
export type Question = {
  id:string;sectionId:string;title:string;prompt:Localized;promptStudy?:Sentence;answer:Sentence[];
  referenceFacts:string[];version:number;status:'ready'|'needs_confirmation'|'archived';parentId?:string;
};
export type Prep = {
  version:number;categories:{id:string;title:string}[];sections:PrepSection[];questions:Question[];
};
export type Settings = {
  title:string;company:string;role:string;questionLanguage:Language;explanationLanguage:Language;speakingNotes:string;
};
export type Manifest = Settings & {schemaVersion:1;interviewId:string};
export const languageLabels = {ko:'한국어',ja:'일본어',en:'영어'};
export type Evaluation={code:'A'|'B'|'C'|'D';reason:string;satisfied?:string[];missing?:string[];errors:{type:string;original:string;correct:string;explanation:string;basis:string}[];corrections:Sentence[];handling:string;referenceIds?:string[]};
export type Attempt={id:string;interviewId:string;sessionId:string;questionId:string;questionVersion:number;questionSnapshot:Question;number:number;kind:string;messageId:string;originalText:string;language:string;at:string;assistanceShown:boolean;evaluation:Evaluation|null};
export type Session={id:string;interviewId:string;createdAt:string;kind:string;queue:string[];askedIds:string[];completed:Record<string,string>;currentQuestionId:string|null;failures:number;assisted:boolean;status:string;hintSectionId:string|null};
export type ChatMessage={id:string;interviewId:string;sessionId:string;questionId:string|null;role:'user'|'assistant';text:string;language:string;origin:string;kind:string;at:string};
export type AppState={interviewId:string;sequence:number;sessions:Session[];messages:ChatMessage[];attempts:Attempt[];revisions:{id:string;messageId:string;text:string;reason:string;at:string}[];verification:{lastToolAt:string|null;voiceValidatedAt:string|null}};
export type Active = {mountId:string;manifest:Manifest;prep:Prep;state:AppState;assets:string[]};
export type Bootstrap = {connectCommand:string;library:Pick<Manifest,'interviewId'|'title'|'company'|'role'|'questionLanguage'>[];lastInterviewId:string|null;active:Active|null};
export const initialSettings:Settings={title:'',company:'',role:'',questionLanguage:'ko',explanationLanguage:'ko',speakingNotes:''};
