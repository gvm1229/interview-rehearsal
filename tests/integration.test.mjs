import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {strToU8,unzipSync,zipSync} from 'fflate';
import {Library} from '../server/library.mjs';
import {importPack} from '../server/archives.mjs';

const requestId = () => ({requestId:randomUUID()});
const settings = (title,questionLanguage) => ({
  title,company:'',role:'',questionLanguage,explanationLanguage:'ko',speakingNotes:'',
});
const material = (text,language) => ({
  categories:[{id:'basics',title:'기본'}],
  sections:[{id:'intro',title:text,categoryId:'basics',aliases:['lookup'],blocks:[
    {type:'question',questionId:'intro'},
    {type:'group',title:'보충',blocks:[{type:'html',html:'<p>보충 사실</p><a href="asset:example.pdf">파일</a>'}]},
  ]}],
  questions:[{
    id:'intro',sectionId:'intro',title:text,prompt:{text,language},
    answer:[{text,language}],referenceFacts:['근거'],status:'ready',
  }],
});

test('HTTP·MCP·SSE·자료 교체·동시 편집·내보내기와 재시작',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'interview-rehearsal-http-'));
  const port=4284;
  const base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server/index.mjs'],{
    env:{...process.env,INTERVIEW_PORT:String(port),INTERVIEW_DATA_DIR:directory},
    stdio:['ignore','pipe','pipe'],
  });
  let errors='';
  server.stderr.on('data',chunk=>{errors+=chunk.toString();});
  const client=new Client({name:'protocol-test',version:'1.0'});
  const abort=new AbortController();
  const api=async(path,options)=>{
    const response=await fetch(base+'/api/'+path,options);
    assert(response.ok,await response.clone().text());
    return response.json();
  };
  const post=(path,body,headers={})=>api(path,{
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),
  });
  const invoke=async(name,args={},expected)=>{
    const result=await client.callTool({name,arguments:args});
    const payload=JSON.parse(result.content[0].text);
    if(expected){assert(result.isError);assert.equal(payload.code,expected);}
    else assert(!result.isError,JSON.stringify(payload));
    return payload;
  };
  try{
    await new Promise((resolve,reject)=>{
      server.stdout.once('data',resolve);
      server.once('exit',code=>reject(Error('server exit '+code+' '+errors)));
      setTimeout(()=>reject(Error('startup timeout '+errors)),5000).unref();
    });
    assert.equal((await api('bootstrap')).active,null);
    assert.deepEqual((await api('bootstrap')).library,[]);
    await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
    assert.equal((await client.listTools()).tools.length,11);
    const publicContext=await invoke('get_context');
    assert.equal(publicContext.status,'connection_required');
    assert(!('question' in publicContext));
    await invoke('get_context',{connectionId:randomUUID()},'CONNECTION_REQUIRED');

    const a=await post('library',settings('연습 A','ja'));
    const b=await post('library',settings('연습 B','en'));
    const c=await post('library',settings('연습 C','ko'));
    const mount=(interviewId,expectedMountId)=>post('mount',{interviewId,expectedMountId});
    const eventStream=await fetch(base+'/api/events',{signal:abort.signal});
    const reader=eventStream.body.getReader();
    await reader.read();
    const mountA=await mount(a.interviewId,null);
    const notice=await Promise.race([reader.read(),new Promise((_,reject)=>{
      setTimeout(()=>reject(Error('SSE 누락')),1500).unref();
    })]);
    assert(new TextDecoder().decode(notice.value).includes(a.interviewId));
    const connectionKey=readFileSync(join(directory,'.connection-key'),'utf8');
    const bind=(threadId,interviewId,mountId)=>post('connect',{threadId,interviewId,mountId},{'x-interview-connection-key':connectionKey});
    const threadA='fixture-thread-a', threadB='fixture-thread-b';
    const grantA=await bind(threadA,a.interviewId,mountA.mountId);
    const callA=(name,args={},expected)=>invoke(name,{...args,connectionId:grantA.connectionId},expected);
    const shared=material('試験用の自己紹介','ja');
    await callA('save_prep',{...requestId(),expectedVersion:1,content:shared});
    assert.equal((await callA('get_prep',{query:'lookup'})).questions[0].id,'intro');
    await callA('start_session',{...requestId(),mode:'new'});
    const next=await callA('next_question',requestId());
    assert.equal(next.question.prompt.language,'ja');
    const utterance={...requestId(),role:'user',text:'試験用の回答です。',origin:'protocol_test'};
    const answer=await callA('record_utterance',utterance);
    const duplicate=await callA('record_utterance',utterance);
    assert.equal(duplicate.attemptId,answer.attemptId);
    await callA('evaluate_answer',{...requestId(),attemptId:answer.attemptId,code:'B',reason:'試験',corrections:[{text:'訂正',language:'ja'}]});
    const changed={...shared.questions[0],prompt:{text:'修正した質問',language:'ja'}};
    await callA('upsert_question',{...requestId(),expectedVersion:2,question:changed});
    await callA('upsert_question',{...requestId(),expectedVersion:2,question:changed},'EDIT_CONFLICT');
    const loadedA=(await api('bootstrap')).active;
    assert.equal(loadedA.prep.sections[0].blocks[1].title,'보충');
    assert.equal(loadedA.state.attempts[0].questionSnapshot.prompt.text,'試験用の自己紹介');
    assert.equal(loadedA.state.messages.length,1);
    assert.equal(loadedA.state.verification.voiceValidatedAt,null);
    const assetResponse=await fetch(base+'/api/assets/'+mountA.mountId+'?name=example.pdf',{
      method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'%PDF-fixture',
    });
    assert.equal(assetResponse.status,201);
    const exportA=format=>fetch(base+'/api/export/'+mountA.mountId+'/'+format);
    const pdfA=base+'/api/files/'+mountA.mountId+'/example.pdf';
    assert.equal(await(await fetch(pdfA)).text(),'%PDF-fixture');
    const csv=await(await exportA('csv')).text();
    assert(csv.includes(a.interviewId)&&csv.includes('"B"'));
    const html=await(await exportA('html')).text();
    assert(html.includes('修正した質問')&&html.includes('보충 사실'));
    assert(!html.includes(utterance.text));
    const dataOnly=new Uint8Array(await(await exportA('pack')).arrayBuffer());
    assert(!('history/events.jsonl' in unzipSync(dataOnly)));
    const full=new Uint8Array(await(await exportA('pack?history=1')).arrayBuffer());
    const restoredRoot=mkdtempSync(join(tmpdir(),'interview-rehearsal-restore-'));
    const restored=new Library(restoredRoot);
    assert.equal(importPack(restored,full).interviewId,a.interviewId);
    assert.throws(()=>importPack(restored,full),{code:'PACK_EXISTS'});
    assert.throws(()=>importPack(restored,zipSync({'../escape.txt':strToU8('invalid')})),{code:'INVALID_PACK'});
    restored.switchTo(a.interviewId,null);
    assert.deepEqual(restored.active.store.state.attempts,loadedA.state.attempts);

    const mountB=await mount(b.interviewId,mountA.mountId);
    await callA('get_context',{},'STALE_MOUNT');
    const denied=await fetch(base+'/api/connect',{
      method:'POST',headers:{'Content-Type':'application/json','x-interview-connection-key':connectionKey},
      body:JSON.stringify({threadId:threadA,interviewId:b.interviewId,mountId:mountB.mountId}),
    });
    assert.equal((await denied.json()).code,'NEW_CHAT_REQUIRED');
    const grantB=await bind(threadB,b.interviewId,mountB.mountId);
    const callB=(name,args={})=>invoke(name,{...args,connectionId:grantB.connectionId});
    await callB('save_prep',{...requestId(),expectedVersion:1,content:material('English prompt','en')});
    assert.equal((await callB('get_prep',{questionId:'intro'})).questions[0].prompt.text,'English prompt');
    assert.equal((await api('bootstrap')).active.state.attempts.length,0);
    assert.equal((await fetch(pdfA)).status,409);
    assert.equal((await exportA('json')).status,409);
    const stale=await fetch(base+'/api/content',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...requestId(),mountId:mountA.mountId,expectedVersion:3,content:shared}),
    });
    assert.equal((await stale.json()).code,'STALE_MOUNT');

    const mountC=await mount(c.interviewId,mountB.mountId);
    await post('content',{...requestId(),mountId:mountC.mountId,expectedVersion:1,content:material('한국어 질문','ko')});
    assert.equal((await api('bootstrap')).active.prep.questions[0].prompt.text,'한국어 질문');
    const resumed=await mount(a.interviewId,mountC.mountId);
    const resumedGrant=await bind(threadA,a.interviewId,resumed.mountId);
    const context=await invoke('get_context',{connectionId:resumedGrant.connectionId});
    assert.equal(context.session.status,'paused');
    await invoke('start_session',{...requestId(),connectionId:resumedGrant.connectionId,mode:'resume'});
    assert.equal((await invoke('get_context',{connectionId:resumedGrant.connectionId})).session.status,'awaiting_repeat');
    assert.equal((await api('bootstrap')).active.state.attempts.length,1);
    const forbidden=await fetch(base+'/api/bootstrap',{headers:{Origin:'https://untrusted.example'}});
    assert.equal(forbidden.status,403);
    const afterRestart=new Library(directory);
    assert.equal(afterRestart.bootstrap().active,null);
    assert.equal(afterRestart.bootstrap().lastInterviewId,a.interviewId);
    afterRestart.switchTo(a.interviewId,null);
    assert.equal(afterRestart.active.store.state.attempts[0].originalText,utterance.text);
    assert.throws(()=>afterRestart.checkThread(threadA,b.interviewId),{code:'NEW_CHAT_REQUIRED'});
  }finally{
    abort.abort();
    await client.close();
    server.kill();
  }
});

