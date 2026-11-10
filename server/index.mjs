import express from 'express';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {existsSync, realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetName, settingsSchema} from './content.mjs';
import {AppError, Library} from './library.mjs';
import {addAsset, assetType, exportHtml, exportPack, importPack, maxUpload} from './archives.mjs';
import {editSchema, makeMcp, pauseSchema, revisionSchema, startSchema} from './mcp.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const data = resolve(process.env.INTERVIEW_DATA_DIR || join(root, 'data', 'private'));
const port = Number(process.env.INTERVIEW_PORT || 4173);
const app = express();
app.disable('x-powered-by');
const clients = new Set();
const library = new Library(data, event => {
  for (const client of clients) client.write('data: ' + JSON.stringify(event) + '\n\n');
});
const connectCommand = 'node "' + join(root, 'scripts', 'connect-interview.mjs') + '"';
const mount = z.object({interviewId:z.uuid().nullable(), expectedMountId:z.uuid().nullable()});
const upload = express.raw({type:'application/octet-stream', limit:maxUpload});

app.use((req,res,next) => {
  if (!['127.0.0.1','localhost','[::1]'].includes(req.hostname)) return res.sendStatus(403);
  const origin=req.get('origin');
  if (origin && ![port,5173].some(p=>['127.0.0.1','localhost'].some(host=>origin==='http://'+host+':'+p))) return res.sendStatus(403);
  if (req.get('sec-fetch-site')==='cross-site' && (req.path.startsWith('/api/') || req.path==='/mcp')) return res.sendStatus(403);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
});
app.use(express.json({limit:'8mb'}));

app.get('/api/health',(_req,res)=>res.json({app:'interview-rehearsal', port}));
app.get('/api/bootstrap',(_req,res)=>res.json({...library.bootstrap(),connectCommand}));
app.get('/api/events',(_req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write('data: '+JSON.stringify(library.signal('connected'))+'\n\n');
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
  res.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});
});
app.post('/api/library', (req,res)=>res.status(201).json(library.create(req.body)));
app.post('/api/mount', (req,res)=>{
  const {interviewId,expectedMountId}=mount.parse(req.body);
  res.json(library.switchTo(interviewId,expectedMountId));
});
app.post('/api/import', upload, (req,res)=>{
  if (!Buffer.isBuffer(req.body)) throw new AppError('INVALID_PACK','자료 파일 필요',400);
  res.status(201).json(importPack(library,req.body));
});
app.post('/api/connect', (req,res)=>{
  library.authorizeKey(req.get('x-interview-connection-key'));
  const {threadId,interviewId,mountId}=z.object({threadId:z.string(),interviewId:z.uuid(),mountId:z.uuid()}).parse(req.body);
  res.json(library.connect(threadId,interviewId,mountId));
});
app.get('/api/connection-target',(req,res)=>{
  library.authorizeKey(req.get('x-interview-connection-key'));
  if(!library.active)throw new AppError('NO_INTERVIEW','앱에서 면접 자료를 먼저 열기');
  const {manifest,mountId}=library.active;
  library.checkThread(req.get('x-codex-thread'), manifest.interviewId);
  res.json({interviewId:manifest.interviewId,mountId});
});

const scoped = (path,schema,fn) => app.post('/api/'+path,(req,res)=>{
  const active=library.requireMount(req.body?.mountId);
  res.json(fn(active,schema.parse(req.body)));
});
scoped('session', startSchema, ({store},input)=>store.start(input));
scoped('pause', pauseSchema, ({store},input)=>store.pause(input));
scoped('transcript-revision', revisionSchema, ({store},input)=>store.revise(input));
scoped('content', editSchema.extend({content:z.object({categories:z.array(z.unknown()),sections:z.array(z.unknown()),questions:z.array(z.unknown())})}),
  ({store},input)=>store.saveContent(input.content,input.expectedVersion,input.requestId));
scoped('settings',z.object({settings:settingsSchema,expectedSettings:settingsSchema}),(active,input)=>{
  const current=settingsSchema.parse(active.manifest);
  if(JSON.stringify(current)!==JSON.stringify(input.expectedSettings)) {
    throw new AppError('EDIT_CONFLICT','저장된 면접 설정과 편집본을 비교한 뒤 재시도 필요',409,{current});
  }
  return library.updateSettings(active,input.settings);
});

app.post('/api/assets/:mountId',upload,(req,res)=>{
  const active=library.requireMount(req.params.mountId);
  if (!Buffer.isBuffer(req.body)) throw new AppError('INVALID_ASSET','첨부 파일 필요',400);
  const name=String(req.query.name || '');
  addAsset(active,name,req.body);
  library.notify(library.signal('assets.changed'));
  res.status(201).json({name});
});
app.get('/api/files/:mountId/:name',(req,res)=>{
  const active=library.requireMount(req.params.mountId);
  const name=assetName.parse(req.params.name);
  const directory=join(active.directory,'assets');
  const file=join(directory,name);
  if (!existsSync(file) || dirname(realpathSync(file))!==realpathSync(directory)) return res.sendStatus(404);
  res.type(assetType(name)).sendFile(file);
});
app.get('/api/export/:mountId/:format',(req,res)=>{
  const active=library.requireMount(req.params.mountId);
  const {store,manifest}=active;
  const prefix='interview-'+manifest.interviewId;
  switch(req.params.format){
    case 'json': return res.type('json').attachment(prefix+'-history.json').send(JSON.stringify({
      exportedAt:new Date().toISOString(),prepVersion:store.prep.version,...store.state,
    },null,2));
    case 'csv': return res.attachment(prefix+'-attempts.csv').type('text/csv; charset=utf-8').send(store.exportCsv());
    case 'pack': return res.type('application/zip').attachment(prefix+'.interviewpack').send(exportPack(active,req.query.history==='1'));
    case 'html': return res.type('html').attachment(prefix+'-prep.html').send(exportHtml(active));
    default: return res.sendStatus(404);
  }
});

app.post('/mcp',async(req,res)=>{
  const mcp=makeMcp(library,connectCommand);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void mcp.close();});
  await mcp.connect(transport);
  await transport.handleRequest(req,res,req.body);
});
app.get('/mcp',(_req,res)=>res.sendStatus(405));
app.delete('/mcp',(_req,res)=>res.sendStatus(405));
app.use('/api',(_req,res)=>res.sendStatus(404));
if (existsSync(join(root,'dist/app/index.html'))) {
  app.use(express.static(join(root,'dist/app')));
  app.get('/{*path}',(_req,res)=>res.sendFile(join(root,'dist/app/index.html')));
}
app.use((error,_req,res,_next)=>res.status(error.status || 400).json({
  code:error.code || 'INVALID_REQUEST', error:error.message, details:error.details,
}));
app.listen(port,'127.0.0.1',()=>console.log('interview-rehearsal: http://127.0.0.1:'+port));

