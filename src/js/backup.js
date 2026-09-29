// Säkerhetskopia: versionsmärkt JSON. Hela filen valideras och normaliseras innan något i lagringen ändras.
import { BACKUP_APP_ID, BACKUP_FORMAT_VERSION, APP_VERSION } from './config.js';

const MIN_TS = Date.UTC(2000, 0, 1);
const MAX_TS = Date.UTC(2100, 0, 1);
const isTs = (n) => Number.isFinite(n) && n >= MIN_TS && n <= MAX_TS;
const isStr = (s) => typeof s === 'string';

export function makeBackup({ projects, sessions, drafts }, now) {
  return {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date(now).toISOString(),
    containsPrivateData: true,
    data: { projects, sessions, drafts },
  };
}

/** Returnerar {ok, errors, data, summary}. data är en ren kopia med enbart kända fält. */
export function validateBackup(input) {
  const errors = [];
  const err = (m) => { if (errors.length < 20) errors.push(m); };

  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Filen är inte en säkerhetskopia från Konsulttimer.'] };
  if (input.app !== BACKUP_APP_ID) return { ok: false, errors: ['Filen är inte en säkerhetskopia från Konsulttimer.'] };
  if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: [input.formatVersion > BACKUP_FORMAT_VERSION
      ? 'Filen är skapad av en nyare version av appen och kan inte läsas här.'
      : 'Filens format stöds inte.'] };
  }
  const d = input.data;
  if (!d || !Array.isArray(d.projects) || !Array.isArray(d.sessions)) return { ok: false, errors: ['Filen saknar projekt eller pass.'] };

  const projects = [];
  const projectIds = new Set();
  d.projects.forEach((p, i) => {
    const at = `Projekt ${i + 1}`;
    if (!p || !isStr(p.id) || !p.id) return err(`${at}: saknar id.`);
    if (projectIds.has(p.id)) return err(`${at}: dubblettid.`);
    if (!isStr(p.name) || !p.name.trim()) return err(`${at}: saknar namn.`);
    if (!isStr(p.client) || !p.client.trim()) return err(`${at}: saknar kundnamn.`);
    if (typeof p.archived !== 'boolean') return err(`${at}: ogiltig arkivstatus.`);
    if (!isTs(p.createdAt) || !isTs(p.updatedAt)) return err(`${at}: ogiltig tidsstämpel.`);
    if (p.lastUsedAt != null && !isTs(p.lastUsedAt)) return err(`${at}: ogiltig tidsstämpel.`);
    projectIds.add(p.id);
    projects.push({ id: p.id, name: p.name, client: p.client, archived: p.archived, createdAt: p.createdAt, updatedAt: p.updatedAt, lastUsedAt: p.lastUsedAt ?? null });
  });

  const sessions = [];
  const sessionIds = new Set();
  let unfinished = 0;
  const checkSegs = (segs, at, status) => {
    if (!Array.isArray(segs) || segs.length === 0) { err(`${at}: saknar tidssegment.`); return null; }
    const out = [];
    let prevEnd = -Infinity;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const open = s && s.end == null;
      if (!s || !isTs(s.start) || (!open && !isTs(s.end))) { err(`${at}: ogiltigt tidssegment.`); return null; }
      if (open && !(status === 'running' && k === segs.length - 1)) { err(`${at}: oavslutat segment i ett avslutat eller pausat pass.`); return null; }
      if (!open && s.end < s.start) { err(`${at}: sluttid före starttid.`); return null; }
      if (s.start < prevEnd) { err(`${at}: överlappande tidssegment.`); return null; }
      prevEnd = open ? s.start : s.end;
      out.push({ start: s.start, end: open ? null : s.end });
    }
    return out;
  };
  d.sessions.forEach((s, i) => {
    const at = `Pass ${i + 1}`;
    if (!s || !isStr(s.id) || !s.id) return err(`${at}: saknar id.`);
    if (sessionIds.has(s.id)) return err(`${at}: dubblettid.`);
    if (!projectIds.has(s.projectId)) return err(`${at}: hör till ett projekt som saknas i filen.`);
    if (!['running', 'paused', 'completed'].includes(s.status)) return err(`${at}: ogiltig status.`);
    if (!['timer', 'manual'].includes(s.origin)) return err(`${at}: ogiltigt ursprung.`);
    if (!isStr(s.description) || !isStr(s.privateNotes)) return err(`${at}: ogiltig text.`);
    if (typeof s.billable !== 'boolean' || typeof s.corrected !== 'boolean') return err(`${at}: ogiltiga fält.`);
    if (!isTs(s.createdAt) || !isTs(s.updatedAt)) return err(`${at}: ogiltig tidsstämpel.`);
    const segments = checkSegs(s.segments, at, s.status);
    if (!segments) return;
    let measured = null;
    if (s.measuredSegments != null) {
      measured = checkSegs(s.measuredSegments, `${at} (uppmätt tid)`, 'completed');
      if (!measured) return;
    }
    if (s.status !== 'completed') unfinished += 1;
    sessionIds.add(s.id);
    sessions.push({
      id: s.id, projectId: s.projectId, status: s.status, origin: s.origin, segments,
      description: s.description, privateNotes: s.privateNotes, billable: s.billable,
      corrected: s.corrected, measuredSegments: measured, createdAt: s.createdAt, updatedAt: s.updatedAt,
    });
  });
  if (unfinished > 1) err('Filen innehåller fler än ett pågående pass.');

  const drafts = {};
  if (d.drafts != null) {
    if (typeof d.drafts !== 'object' || Array.isArray(d.drafts)) err('Textutkasten har ogiltigt format.');
    else {
      for (const [id, v] of Object.entries(d.drafts)) {
        if (!sessionIds.has(id)) continue; // utkast utan pass ignoreras
        if (!v || !isStr(v.description) || !isStr(v.privateNotes) || typeof v.billable !== 'boolean') { err('Ett textutkast har ogiltigt format.'); continue; }
        drafts[id] = { description: v.description, privateNotes: v.privateNotes, billable: v.billable };
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  const starts = sessions.map((s) => s.segments[0].start).sort((a, b) => a - b);
  return {
    ok: true, errors: [],
    data: { projects, sessions, drafts },
    summary: {
      exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : null,
      projects: projects.length,
      archivedProjects: projects.filter((p) => p.archived).length,
      sessions: sessions.length,
      firstStart: starts[0] ?? null,
      lastStart: starts[starts.length - 1] ?? null,
      hasUnfinished: unfinished > 0,
    },
  };
}
