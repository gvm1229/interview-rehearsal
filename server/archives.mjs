import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';
import {assetName, contentSchema, manifestSchema, safeHtml} from './content.mjs';
import {AppError, writeJson} from './library.mjs';
import {InterviewStore} from './store.mjs';

export const maxUpload = 48 * 1024 * 1024;
const maxAsset = 16 * 1024 * 1024;
const maxExpanded = 64 * 1024 * 1024;
const invalid = message => new AppError('INVALID_PACK', message, 400);

export function assetType(name) {
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  return 'image/webp';
}

export function validateAsset(name, bytes) {
  assetName.parse(name);
  if (bytes.length > maxAsset) throw invalid('첨부 용량 한도 초과');
  const data = Buffer.from(bytes);
  const type = assetType(name);
  const valid = type === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' :
    type === 'image/png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) :
    type === 'image/jpeg' ? data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) :
    data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw invalid('첨부 확장자와 파일 형식 불일치');
}

export function addAsset(active, name, bytes) {
  validateAsset(name, bytes);
  const path = join(active.directory, 'assets', name);
  if (existsSync(path)) throw new AppError('ASSET_EXISTS', '같은 이름의 첨부가 이미 존재');
  writeFileSync(path, bytes, {flag: 'wx'});
}

function validateHistory(raw, interviewId) {
  for (const line of raw.split('\n').filter(line => line.trim())) {
    const e = JSON.parse(line);
    if (e.interviewId !== interviewId || !Number.isInteger(e.sequence) || typeof e.requestId !== 'string' ||
        !e.payload || typeof e.type !== 'string') throw invalid('기록의 면접 범위 또는 형식 불일치');
    const {session, attempt, messages, revision, verification} = e.payload;
    if ((session && (!Array.isArray(session.queue) || !Array.isArray(session.askedIds) || !session.completed)) ||
        (messages && !Array.isArray(messages)) ||
        (attempt && (!attempt.questionSnapshot || (attempt.evaluation && !Array.isArray(attempt.evaluation.corrections)))) ||
        (verification && typeof verification !== 'object')) throw invalid('연습 기록 형식 불일치');
    for (const entry of [session, attempt, ...(messages || []), revision]) {
      if (entry && (entry.interviewId !== interviewId || typeof entry.id !== 'string')) {
        throw invalid('연습 기록의 면접 식별자 불일치');
      }
    }
  }
}

export function importPack(library, bytes) {
  if (bytes.length > maxUpload || bytes.length < 22) throw invalid('자료 묶음 크기 확인 필요');
  let expanded = 0;
  const names = new Set();
  const sizes = new Map();
  const zip = unzipSync(bytes, {filter: file => {
    const {name, originalSize} = file;
    const key = name.toLowerCase();
    if (names.has(key)) throw invalid('묶음 내부 파일 이름 중복');
    names.add(key);
    if (names.size > 120 || !Number.isSafeInteger(originalSize) || originalSize < 0) throw invalid('묶음 내부 파일 한도 초과');
    expanded += originalSize;
    if (expanded > maxExpanded) throw invalid('압축을 푼 자료의 용량 한도 초과');
    sizes.set(name, originalSize);
    if (['manifest.json', 'content.json', 'history/events.jsonl'].includes(name)) return true;
    if (!name.startsWith('assets/')) throw invalid('자료 묶음의 지원하지 않는 경로');
    assetName.parse(name.slice(7));
    if (originalSize > maxAsset) throw invalid('첨부 용량 한도 초과');
    return true;
  }});
  if (!zip['manifest.json'] || !zip['content.json']) throw invalid('자료 설명 또는 본문 파일 없음');
  for (const [name, data] of Object.entries(zip)) {
    if (data.length !== sizes.get(name)) throw invalid('압축 파일 크기 불일치');
    if (name.startsWith('assets/')) validateAsset(name.slice(7), data);
  }
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(zip['manifest.json'])));
  const content = contentSchema.parse(JSON.parse(strFromU8(zip['content.json'])));
  delete content.lastEdit;
  const target = library.directory(manifest.interviewId);
  if (existsSync(target)) throw new AppError('PACK_EXISTS', '같은 면접이 이미 보관된 상태');
  const raw = zip['history/events.jsonl'] && strFromU8(zip['history/events.jsonl']);
  if (raw) validateHistory(raw, manifest.interviewId);
  const stage = mkdtempSync(join(library.packs, '.import-'));
  try {
    mkdirSync(join(stage, 'assets'));
    mkdirSync(join(stage, 'history'));
    writeJson(join(stage, 'manifest.json'), manifest);
    writeJson(join(stage, 'content.json'), content);
    for (const [name, data] of Object.entries(zip)) {
      if (name.startsWith('assets/')) writeFileSync(join(stage, name), data);
    }
    if (raw) {
      writeFileSync(join(stage, 'history', 'events.jsonl'), raw);
      const store = new InterviewStore(join(stage, 'history'), content, () => {}, {interviewId: manifest.interviewId});
      writeJson(join(stage, 'history', 'progress.json'), store.state);
    }
    renameSync(stage, target);
  } catch (error) {
    if (dirname(resolve(stage)) === resolve(library.packs)) rmSync(stage, {force: true, recursive: true});
    throw error;
  }
  library.notify(library.signal('library.changed'));
  return manifest;
}

export function exportPack(active, withHistory) {
  const {manifest, directory, store} = active;
  const {lastEdit: _lastEdit, ...content} = store.prep;
  const files = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'content.json': strToU8(JSON.stringify(content, null, 2)),
  };
  for (const item of readdirSync(join(directory, 'assets'), {withFileTypes: true})) {
    if (item.isFile() && assetName.safeParse(item.name).success) {
      files['assets/' + item.name] = readFileSync(join(directory, 'assets', item.name));
    }
  }
  if (withHistory && existsSync(store.log)) files['history/events.jsonl'] = readFileSync(store.log);
  if (Object.keys(files).length > 120 || Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > maxExpanded) {
    throw invalid('내보낼 자료의 용량 또는 파일 수 한도 초과');
  }
  const bytes = zipSync(files, {level: 6});
  if (bytes.length > maxUpload) throw invalid('압축 자료 용량 한도 초과');
  return Buffer.from(bytes);
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function exportHtml(active) {
  const {manifest, store} = active;
  const {sections, questions} = store.prep;
  const byId = new Map(questions.map(q => [q.id, q]));
  const renderSentence = s => '<div class="sentence"><p lang="' + s.language + '">' +
    (s.rubyHtml || escape(s.text)) + '</p>' +
    (s.reading ? '<p class="reading" lang="' + s.reading.language + '">' + escape(s.reading.text) + '</p>' : '') +
    (s.translation ? '<p class="translation" lang="' + s.translation.language + '">' + escape(s.translation.text) + '</p>' : '') + '</div>';
  const renderBlocks = blocks => blocks.map(block => {
    if (block.type === 'html') return safeHtml(block.html);
    if (block.type === 'group') return '<details' + (block.anchor ? ' id="' + escape(block.anchor) + '"' : '') +
      '><summary>' + escape(block.title) + '</summary>' + renderBlocks(block.blocks) + '</details>';
    const q = byId.get(block.questionId);
    if (!q || q.status === 'archived') return '';
    return '<article id="item-' + escape(q.id) + '">' + renderSentence(q.promptStudy || q.prompt) +
      q.answer.map(renderSentence).join('') +
      q.referenceFacts.map(fact => '<p class="translation">' + escape(fact) + '</p>').join('') + '</article>';
  }).join('');
  const nav = sections.map(section => '<li><a href="#' + escape(section.id) + '">' + escape(section.title) + '</a></li>').join('');
  const body = sections.map(section => '<section id="' + escape(section.id) + '"><h2>' + escape(section.title) + '</h2>' +
    renderBlocks(section.blocks) + '</section>').join('');
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escape(manifest.title) + ' · Prep</title><style>body{font:16px/1.75 system-ui,sans-serif;margin:2rem auto;max-width:55rem;padding:0 1rem;color:#17202b}section{border-top:1px solid #ddd;margin:2rem 0}details{margin:1rem 0}summary{cursor:pointer;font-weight:650}.sentence{border-bottom:1px solid #eee}.reading,.translation,.study-note{color:#596271}rt{font-size:.55em}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.5rem}a{color:#205a96}</style>' +
    '<h1>' + escape(manifest.title) + '</h1><p>Prep 보조 사본 · 첨부 원본은 자료 묶음에서 열기</p><nav><ul>' + nav + '</ul></nav>' + body + '</html>';
}

