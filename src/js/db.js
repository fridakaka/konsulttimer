// Lagring i IndexedDB. Varje ändring är en transaktion som läser aktuellt tillstånd och skriver resultatet,
// så att dubbelklick och flera flikar inte kan skapa flera aktiva pass eller dubbla poster.
import { DB_NAME, CHANNEL_NAME } from './config.js';
import { AppError } from './errors.js';
import * as T from './timer.js';

const DB_VERSION = 1;
const MAX_TEXT = 20000;

const rq = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

function trimName(v, label) {
  const s = String(v ?? '').trim();
  if (!s) throw new AppError('INVALID', `${label} måste fyllas i.`);
  if (s.length > 200) throw new AppError('INVALID', `${label} är för långt.`);
  return s;
}

function text(v, label) {
  const s = String(v ?? '').trim();
  if (s.length > MAX_TEXT) throw new AppError('INVALID', `${label} är för lång.`);
  return s;
}

export function openStore({ indexedDB = globalThis.indexedDB, name = DB_NAME, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new AppError('STORAGE', 'Webbläsaren saknar stöd för lokal lagring (IndexedDB).'));
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(new Store(req.result, { now, uuid }));
    req.onerror = () => reject(new AppError('STORAGE', 'Det gick inte att öppna den lokala lagringen. Är webbläsaren i privat läge?'));
    req.onblocked = () => reject(new AppError('STORAGE', 'Lagringen är blockerad av en annan flik. Stäng andra flikar med appen.'));
  });
}

export class Store {
  constructor(db, { now, uuid }) {
    this.db = db;
    this.now = now;
    this.uuid = uuid;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    this.channel?.unref?.(); // i Node ska kanalen inte hålla processen vid liv
  }

  onChange(fn) {
    if (this.channel) this.channel.addEventListener('message', fn);
  }

  /** Kör fn i en transaktion. Fel inuti avbryter hela transaktionen; inget halvsparat blir kvar. */
  run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      let t;
      try {
        t = this.db.transaction(stores, mode);
      } catch (e) {
        return reject(new AppError('STORAGE', 'Lagringen är inte tillgänglig just nu.', e));
      }
      let result;
      let failure = null;
      t.oncomplete = () => {
        if (mode === 'readwrite') this.channel?.postMessage('changed');
        resolve(result);
      };
      t.onabort = () => reject(failure ?? new AppError('STORAGE', 'Det gick inte att spara. Inget har ändrats.', t.error));
      t.onerror = () => { failure = failure ?? new AppError('STORAGE', 'Det gick inte att spara. Inget har ändrats.', t.error); };
      Promise.resolve()
        .then(() => fn(t))
        .then((r) => { result = r; })
        .catch((e) => {
          failure = e;
          try { t.abort(); } catch { /* redan avbruten */ }
        });
    });
  }

  // ---- läsning ----
  getProjects() { return this.run(['projects'], 'readonly', (t) => rq(t.objectStore('projects').getAll())); }
  getSessions() { return this.run(['sessions'], 'readonly', (t) => rq(t.objectStore('sessions').getAll())); }
  getSession(id) { return this.run(['sessions'], 'readonly', (t) => rq(t.objectStore('sessions').get(id))); }

  getActive() {
    return this.run(['sessions', 'meta'], 'readonly', (t) => this._active(t));
  }

  async _active(t) {
    const m = await rq(t.objectStore('meta').get('activeId'));
    if (!m?.value) return null;
    const s = await rq(t.objectStore('sessions').get(m.value));
    return s && s.status !== 'completed' ? s : null;
  }

  // ---- projekt ----
  async createProject({ name, client }) {
    const p = {
      id: this.uuid(), name: trimName(name, 'Projektnamn'), client: trimName(client, 'Kundnamn'),
      archived: false, createdAt: this.now(), updatedAt: this.now(), lastUsedAt: null,
    };
    return this.run(['projects'], 'readwrite', async (t) => { await rq(t.objectStore('projects').put(p)); return p; });
  }

  async updateProject(id, { name, client }) {
    const n = trimName(name, 'Projektnamn');
    const c = trimName(client, 'Kundnamn');
    return this.run(['projects'], 'readwrite', async (t) => {
      const p = await rq(t.objectStore('projects').get(id));
      if (!p) throw new AppError('NOT_FOUND', 'Projektet finns inte längre.');
      const upd = { ...p, name: n, client: c, updatedAt: this.now() };
      await rq(t.objectStore('projects').put(upd));
      return upd;
    });
  }

  setArchived(id, archived) {
    return this.run(['projects', 'sessions', 'meta'], 'readwrite', async (t) => {
      const p = await rq(t.objectStore('projects').get(id));
      if (!p) throw new AppError('NOT_FOUND', 'Projektet finns inte längre.');
      if (archived) {
        const act = await this._active(t);
        if (act && act.projectId === id) throw new AppError('ACTIVE_EXISTS', 'Stoppa det pågående passet innan projektet arkiveras.');
      }
      const upd = { ...p, archived: !!archived, updatedAt: this.now() };
      await rq(t.objectStore('projects').put(upd));
      return upd;
    });
  }

  // ---- timer ----
  startSession(projectId) {
    return this.run(['projects', 'sessions', 'meta'], 'readwrite', async (t) => {
      const projects = t.objectStore('projects');
      const p = await rq(projects.get(projectId));
      if (!p) throw new AppError('NOT_FOUND', 'Välj ett projekt först.');
      if (p.archived) throw new AppError('INVALID', 'Projektet är arkiverat. Återaktivera det för att registrera nytt pass.');
      const existing = await this._active(t);
      if (existing) throw new AppError('ACTIVE_EXISTS', 'Ett pass pågår redan.', existing);
      const now = this.now();
      const s = T.newSession({ id: this.uuid(), projectId, now });
      await rq(t.objectStore('sessions').put(s));
      await rq(t.objectStore('meta').put({ key: 'activeId', value: s.id }));
      await rq(projects.put({ ...p, lastUsedAt: now }));
      return s;
    });
  }

  _transition(id, fn) {
    return this.run(['sessions', 'meta'], 'readwrite', async (t) => {
      const sessions = t.objectStore('sessions');
      const s = await rq(sessions.get(id));
      if (!s) throw new AppError('NOT_FOUND', 'Passet finns inte längre.');
      const upd = fn(s, this.now());
      if (upd !== s) await rq(sessions.put(upd));
      const meta = t.objectStore('meta');
      if (upd.status === 'completed') {
        const m = await rq(meta.get('activeId'));
        if (m?.value === id) await rq(meta.put({ key: 'activeId', value: null }));
      }
      return upd;
    });
  }

  pauseSession(id) { return this._transition(id, (s, now) => T.pause(s, now)); }
  resumeSession(id) {
    return this.run(['sessions', 'meta'], 'readwrite', async (t) => {
      const sessions = t.objectStore('sessions');
      const s = await rq(sessions.get(id));
      if (!s) throw new AppError('NOT_FOUND', 'Passet finns inte längre.');
      const upd = T.resume(s, this.now());
      if (upd !== s) await rq(sessions.put(upd));
      return upd;
    });
  }
  /** Sparar passets tid beständigt. Anteckning hanteras därefter separat och kan aldrig påverka tiden. */
  stopSession(id, { endAt } = {}) { return this._transition(id, (s, now) => T.stop(s, now, endAt)); }

  changeActiveProject(id, projectId) {
    return this.run(['projects', 'sessions'], 'readwrite', async (t) => {
      const s = await rq(t.objectStore('sessions').get(id));
      if (!s || s.status === 'completed') throw new AppError('NOT_FOUND', 'Det finns inget pågående pass.');
      const p = await rq(t.objectStore('projects').get(projectId));
      if (!p || p.archived) throw new AppError('INVALID', 'Välj ett aktivt projekt.');
      await rq(t.objectStore('projects').put({ ...p, lastUsedAt: this.now() }));
      const upd = { ...s, projectId, updatedAt: this.now() };
      await rq(t.objectStore('sessions').put(upd));
      return upd;
    });
  }

  // ---- pass: redigering ----
  /**
   * Uppdaterar anteckningar, projekt, debiterbarhet och (valfritt) tid i en enda transaktion.
   * patch: {projectId?, description?, privateNotes?, billable?, time?: {date, start, durationMs}}
   * clearDraft: rensa textutkastet i samma transaktion.
   */
  async updateSession(id, patch, { clearDraft = false } = {}) {
    const desc = patch.description !== undefined ? text(patch.description, 'Arbetsbeskrivningen') : undefined;
    const priv = patch.privateNotes !== undefined ? text(patch.privateNotes, 'Anteckningen') : undefined;
    return this.run(['projects', 'sessions', 'meta'], 'readwrite', async (t) => {
      const sessions = t.objectStore('sessions');
      let s = await rq(sessions.get(id));
      if (!s) throw new AppError('NOT_FOUND', 'Passet finns inte längre.');
      const now = this.now();
      if (patch.projectId !== undefined) {
        if (!patch.projectId) throw new AppError('INVALID', 'Välj ett projekt.');
        const p = await rq(t.objectStore('projects').get(patch.projectId));
        if (!p) throw new AppError('INVALID', 'Projektet finns inte.');
        if (p.archived && patch.projectId !== s.projectId) throw new AppError('INVALID', 'Projektet är arkiverat.');
        s = { ...s, projectId: patch.projectId };
      }
      if (desc !== undefined) s = { ...s, description: desc };
      if (priv !== undefined) s = { ...s, privateNotes: priv };
      if (patch.billable !== undefined) s = { ...s, billable: !!patch.billable };
      if (patch.time) {
        if (s.status !== 'completed') throw new AppError('INVALID', 'Stoppa passet innan tiden rättas.');
        s = T.withCorrectedTime(s, patch.time, now);
      }
      s = { ...s, updatedAt: now };
      await rq(sessions.put(s));
      if (clearDraft) await rq(t.objectStore('meta').delete(`draft:${id}`));
      return s;
    });
  }

  async addManualSession({ projectId, date, start, durationMs, description = '', privateNotes = '', billable = true }) {
    if (!projectId) return Promise.reject(new AppError('INVALID', 'Välj ett projekt.'));
    const desc = text(description, 'Arbetsbeskrivningen');
    const priv = text(privateNotes, 'Anteckningen');
    return this.run(['projects', 'sessions'], 'readwrite', async (t) => {
      const p = await rq(t.objectStore('projects').get(projectId));
      if (!p) throw new AppError('INVALID', 'Projektet finns inte.');
      if (p.archived) throw new AppError('INVALID', 'Projektet är arkiverat. Återaktivera det först.');
      const s = T.newManualSession({ id: this.uuid(), projectId, date, start, durationMs, description: desc, privateNotes: priv, billable, now: this.now() });
      await rq(t.objectStore('sessions').put(s));
      return s;
    });
  }

  deleteSession(id) {
    return this.run(['sessions', 'meta'], 'readwrite', async (t) => {
      const s = await rq(t.objectStore('sessions').get(id));
      if (!s) return false; // redan borttaget
      if (s.status !== 'completed') throw new AppError('INVALID', 'Stoppa passet innan det tas bort.');
      await rq(t.objectStore('sessions').delete(id));
      await rq(t.objectStore('meta').delete(`draft:${id}`));
      return true;
    });
  }

  // ---- textutkast för arbetsanteckning ----
  saveDraft(id, draft) {
    return this.run(['meta'], 'readwrite', (t) => rq(t.objectStore('meta').put({ key: `draft:${id}`, value: draft })));
  }
  getDraft(id) {
    return this.run(['meta'], 'readonly', async (t) => (await rq(t.objectStore('meta').get(`draft:${id}`)))?.value ?? null);
  }

  // ---- säkerhetskopia ----
  exportAll() {
    return this.run(['projects', 'sessions', 'meta'], 'readonly', async (t) => {
      const [projects, sessions, metas] = await Promise.all([
        rq(t.objectStore('projects').getAll()), rq(t.objectStore('sessions').getAll()), rq(t.objectStore('meta').getAll()),
      ]);
      const drafts = {};
      for (const m of metas) if (m.key.startsWith('draft:') && m.value) drafts[m.key.slice(6)] = m.value;
      return { projects, sessions, drafts };
    });
  }

  /** Ersätter all data atomärt. Avvisas om en timer är aktiv. data ska vara validerad via backup.js. */
  replaceAll({ projects, sessions, drafts }) {
    return this.run(['projects', 'sessions', 'meta'], 'readwrite', async (t) => {
      if (await this._active(t)) throw new AppError('ACTIVE_EXISTS', 'Ett pass pågår. Stoppa timern innan du återställer.');
      const ps = t.objectStore('projects');
      const ss = t.objectStore('sessions');
      const ms = t.objectStore('meta');
      await Promise.all([rq(ps.clear()), rq(ss.clear()), rq(ms.clear())]);
      for (const p of projects) ps.put(p);
      for (const s of sessions) ss.put(s);
      for (const [id, d] of Object.entries(drafts)) ms.put({ key: `draft:${id}`, value: d });
      const act = sessions.find((s) => s.status !== 'completed');
      ms.put({ key: 'activeId', value: act ? act.id : null });
    });
  }

  close() { this.db.close(); this.channel?.close(); }
}
