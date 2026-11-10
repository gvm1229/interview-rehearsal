import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const threadId = process.env.CODEX_THREAD_ID;
if (!threadId) {
  console.error('CODEX_THREAD_ID 확인 불가. 현재 Codex 대화의 명령 실행 도구에서 연결 필요.');
  process.exit(1);
}
const directory = process.env.INTERVIEW_DATA_DIR || fileURLToPath(new URL('../data/private/', import.meta.url));
const base = 'http://127.0.0.1:' + Number(process.env.INTERVIEW_PORT || 4173);
const headers = {
  'x-interview-connection-key':readFileSync(join(directory,'.connection-key'),'utf8'),
  'x-codex-thread':threadId,
  'Content-Type':'application/json',
};
async function call(path, body) {
  const response = await fetch(base+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const data = await response.json();
  if(!response.ok) throw Error((data.code || 'CONNECTION_FAILED')+': '+data.error);
  return data;
}
try {
  const target = await call('/api/connection-target');
  const expectedInterviewId = process.argv[2];
  if (expectedInterviewId && target.interviewId !== expectedInterviewId) {
    throw Error('INTERVIEW_MISMATCH: 앱에서 시작 문구를 복사한 면접을 다시 열어 주세요.');
  }
  const connection = await call('/api/connect',{...target,threadId});
  console.log(JSON.stringify(connection));
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}

