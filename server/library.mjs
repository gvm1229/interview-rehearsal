import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID, randomBytes, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {contentSchema, emptyContent, manifestSchema, settingsSchema} from './content.mjs';
import {InterviewStore} from './store.mjs';

export class AppError extends Error {
  constructor(code, message, status = 409, details) {
    super(message);
    Object.assign(this, {code, status, details});
  }
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export function writeJson(path, value) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2));
  renameSync(path + '.tmp', path);
}

export class Library {
  active = null;
  connections = new Map();

  constructor(root, notify = () => {}) {
    this.root = root;
    this.notify = notify;
    this.packs = join(root, 'interviews');
    mkdirSync(this.packs, {recursive: true});
    this.settingsFile = join(root, 'settings.json');
    this.bindingsFile = join(root, 'thread-bindings.json');
    this.settings = existsSync(this.settingsFile) ? readJson(this.settingsFile) : {};
    this.bindings = new Map(Object.entries(existsSync(this.bindingsFile) ? readJson(this.bindingsFile) : {}));
    const keyFile = join(root, '.connection-key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), {mode: 0o600, flag: 'wx'});
    this.connectionKey = Buffer.from(readFileSync(keyFile, 'utf8'));
  }

  directory(id) {
    return join(this.packs, z.uuid().parse(id));
  }

  list() {
    return readdirSync(this.packs, {withFileTypes: true}).flatMap(item => {
      if (!item.isDirectory() || !z.uuid().safeParse(item.name).success) return [];
      try {
        const manifest = manifestSchema.parse(readJson(join(this.directory(item.name), 'manifest.json')));
        return manifest.interviewId === item.name ? [manifest] : [];
      } catch { return []; }
    }).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }

  create(settings) {
    const manifest = manifestSchema.parse({schemaVersion: 1, interviewId: randomUUID(), ...settingsSchema.parse(settings)});
    const directory = this.directory(manifest.interviewId);
    mkdirSync(directory);
    mkdirSync(join(directory, 'assets'));
    mkdirSync(join(directory, 'history'));
    writeJson(join(directory, 'content.json'), emptyContent());
    writeJson(join(directory, 'manifest.json'), manifest);
    this.notify(this.signal('library.changed'));
    return manifest;
  }

  signal(type) {
    return {
      type, interviewId: this.active?.manifest.interviewId ?? null,
      mountId: this.active?.mountId ?? null, sequence: this.active?.store.state.sequence ?? 0,
    };
  }

  bootstrap() {
    return {
      library: this.list().map(({interviewId,title,company,role,questionLanguage}) => ({interviewId,title,company,role,questionLanguage})), lastInterviewId: this.settings.lastInterviewId ?? null,
      active: this.active && {
        mountId: this.active.mountId, manifest: this.active.manifest,
        prep: this.active.store.prep, state: this.active.store.state,
        assets: readdirSync(join(this.active.directory, 'assets'), {withFileTypes: true})
          .filter(item => item.isFile()).map(item => item.name),
      },
    };
  }

  switchTo(interviewId, expectedMountId) {
    if (expectedMountId !== (this.active?.mountId ?? null)) this.stale();
    if (interviewId === (this.active?.manifest.interviewId ?? null)) return this.signal('mount.changed');
    let next = null;
    if (interviewId !== null) {
      const directory = this.directory(interviewId);
      if (!existsSync(join(directory, 'manifest.json'))) throw new AppError('INTERVIEW_NOT_FOUND', '면접 자료 없음', 404);
      const manifest = manifestSchema.parse(readJson(join(directory, 'manifest.json')));
      if (manifest.interviewId !== interviewId) throw new AppError('INVALID_PACK', '면접 식별자 불일치', 400);
      const prep = contentSchema.parse(readJson(join(directory, 'content.json')));
      const mountId = randomUUID();
      const store = new InterviewStore(join(directory, 'history'), prep, event => {
        if (this.active?.mountId === mountId) this.notify({...this.signal(event.type), sequence: event.sequence});
      }, {interviewId, contentPath: join(directory, 'content.json'), language: manifest.questionLanguage});
      next = {directory, manifest, mountId, store};
    }
    const current = this.active?.store;
    const session = current?.state.sessions.at(-1);
    if (session && !['paused', 'completed'].includes(session.status)) {
      current.pause({requestId: randomUUID(), sessionId: session.id});
    }
    const settings = next ? {lastInterviewId: interviewId} : this.settings;
    writeJson(this.settingsFile, settings);
    this.settings = settings;
    this.active = next;
    // Keep revoked IDs so a delayed request receives a specific stale-mount error.
    for (const [token, grant] of this.connections) {
      if (grant.mountId !== next?.mountId) this.connections.set(token, {...grant, revoked: true});
    }
    if (this.connections.size > 512) {
      for (const [token, grant] of this.connections) {
        if (grant.revoked) this.connections.delete(token);
        if (this.connections.size <= 512) break;
      }
    }
    const event = this.signal('mount.changed');
    this.notify(event);
    return event;
  }

  stale() {
    throw new AppError('STALE_MOUNT', '면접 자료가 바뀐 상태. 현재 자료를 다시 확인한 뒤 재시도 필요');
  }

  requireMount(mountId) {
    if (!this.active || this.active.mountId !== mountId) this.stale();
    return this.active;
  }

  authorizeKey(key) {
    const supplied = Buffer.from(typeof key === 'string' ? key : '');
    if (supplied.length !== this.connectionKey.length || !timingSafeEqual(supplied, this.connectionKey)) {
      throw new AppError('CONNECTION_REQUIRED', '현재 Codex 대화의 연결 도우미 실행 필요', 403);
    }
  }

  checkThread(threadId, interviewId) {
    z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/).parse(threadId);
    const existing = this.bindings.get(threadId);
    if (existing && existing !== interviewId) {
      throw new AppError('NEW_CHAT_REQUIRED', '이 대화는 다른 면접에 연결된 상태. 새 면접은 빈 새 Codex 대화에서 시작');
    }
  }

  connect(threadId, interviewId, mountId) {
    this.checkThread(threadId, interviewId);
    const active = this.requireMount(mountId);
    if (active.manifest.interviewId !== interviewId) this.stale();
    if (!this.bindings.has(threadId)) {
      const bindings = new Map(this.bindings).set(threadId, interviewId);
      writeJson(this.bindingsFile, Object.fromEntries(bindings));
      this.bindings = bindings;
    }
    const previous = [...this.connections].find(([, grant]) => !grant.revoked && grant.threadId === threadId && grant.mountId === mountId);
    const connectionId = previous?.[0] ?? randomUUID();
    this.connections.set(connectionId, {threadId, interviewId, mountId});
    return {connectionId, interviewId, mountId};
  }

  requireConnection(connectionId) {
    const grant = this.connections.get(connectionId);
    if (!grant) throw new AppError('CONNECTION_REQUIRED', '현재 Codex 대화의 연결 도우미 실행 필요', 403);
    if (grant.revoked || grant.mountId !== this.active?.mountId) this.stale();
    if (this.bindings.get(grant.threadId) !== this.active.manifest.interviewId) {
      throw new AppError('NEW_CHAT_REQUIRED', '새 면접은 빈 새 Codex 대화에서 시작');
    }
    return this.active;
  }

  updateSettings(active, input) {
    const manifest = manifestSchema.parse({...active.manifest, ...settingsSchema.parse(input)});
    writeJson(join(active.directory, 'manifest.json'), manifest);
    active.manifest = manifest;
    active.store.language = manifest.questionLanguage;
    this.notify(this.signal('settings.changed'));
    return manifest;
  }
}

