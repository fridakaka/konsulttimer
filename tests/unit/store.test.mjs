import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, ms } from './helpers.mjs';
import { workedMs } from '../../src/js/timer.js';
import { makeBackup, validateBackup } from '../../src/js/backup.js';

const MIN = 60000;

async function withProject() {
  const ctx = await makeStore();
  const p = await ctx.store.createProject({ name: 'Webb', client: 'Acme' });
  return { ...ctx, p };
}

test('projekt: skapa, redigera, arkivera, återaktivera utan att förlora historik', async () => {
  const { store, p, clock } = await withProject();
  await assert.rejects(() => store.createProject({ name: ' ', client: 'x' }), /Projektnamn/);
  await assert.rejects(() => store.createProject({ name: 'x', client: '' }), /Kundnamn/);
  await store.updateProject(p.id, { name: 'Webb 2', client: 'Acme AB' });
  await store.startSession(p.id); clock.t += 30 * MIN; const s = await store.stopSession((await store.getSessions())[0].id);
  await store.setArchived(p.id, true);
  assert.equal((await store.getProjects())[0].archived, true);
  assert.equal((await store.getSessions()).length, 1);
  await assert.rejects(() => store.startSession(p.id), /arkiverat/);
  await store.setArchived(p.id, false);
  assert.equal((await store.getProjects())[0].name, 'Webb 2');
  assert.equal(s.status, 'completed');
});

test('bara ett aktivt pass: samtidiga starter (dubbelklick/flera flikar) ger exakt ett pass', async () => {
  const { store, p } = await withProject();
  const res = await Promise.allSettled([store.startSession(p.id), store.startSession(p.id), store.startSession(p.id)]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(res.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'ACTIVE_EXISTS'));
  assert.equal((await store.getSessions()).length, 1);
});

test('start på annat projekt medan ett pass pågår avvisas', async () => {
  const { store, p } = await withProject();
  const p2 = await store.createProject({ name: 'Annat', client: 'Beta' });
  await store.startSession(p.id);
  await assert.rejects(() => store.startSession(p2.id), /pågår redan/);
  await assert.rejects(() => store.setArchived(p.id, true), /Stoppa/);
});

test('timern överlever omladdning (ny anslutning) och bakgrundsläge (klockan går)', async () => {
  const { store, p, clock, reopen } = await withProject();
  await store.startSession(p.id);
  clock.t += 10 * MIN;
  await store.pauseSession((await store.getActive()).id);
  clock.t += 20 * MIN; // pausad, appen "stängd"
  const store2 = await reopen();
  let a = await store2.getActive();
  assert.equal(a.status, 'paused');
  assert.equal(workedMs(a, clock.t), 10 * MIN);
  await store2.resumeSession(a.id);
  clock.t += 5 * MIN; // skärmlås/bakgrund
  const store3 = await reopen();
  a = await store3.getActive();
  assert.equal(a.status, 'running');
  assert.equal(workedMs(a, clock.t), 15 * MIN);
});

test('upprepad paus/fortsätt/stopp skapar inga dubbletter och ändrar inte tiden', async () => {
  const { store, p, clock } = await withProject();
  const s = await store.startSession(p.id);
  clock.t += 10 * MIN;
  await Promise.all([store.pauseSession(s.id), store.pauseSession(s.id)]);
  clock.t += 10 * MIN;
  await Promise.all([store.resumeSession(s.id), store.resumeSession(s.id)]);
  clock.t += 10 * MIN;
  const [a, b] = await Promise.all([store.stopSession(s.id), store.stopSession(s.id)]);
  clock.t += 60 * MIN;
  const c = await store.stopSession(s.id);
  assert.equal(workedMs(a, 0), 20 * MIN);
  assert.equal(workedMs(b, 0), 20 * MIN);
  assert.equal(workedMs(c, 0), 20 * MIN);
  assert.equal((await store.getSessions()).length, 1);
  assert.equal(await store.getActive(), null);
});

test('stoppat pass överlever avbruten anteckning och textutkast bevaras', async () => {
  const { store, p, clock, reopen } = await withProject();
  const s = await store.startSession(p.id);
  clock.t += 45 * MIN;
  await store.stopSession(s.id);
  await store.saveDraft(s.id, { description: 'halvskriven', privateNotes: '', billable: false });
  // användaren laddar om utan att spara
  const again = await reopen();
  const saved = await again.getSession(s.id);
  assert.equal(saved.status, 'completed');
  assert.equal(workedMs(saved, 0), 45 * MIN);
  assert.equal(saved.description, ''); // syns som "Saknar arbetsbeskrivning"
  assert.deepEqual(await again.getDraft(s.id), { description: 'halvskriven', privateNotes: '', billable: false });
  // komplettera senare + rensa utkast i samma transaktion
  await again.updateSession(s.id, { description: 'Klart', privateNotes: 'internt', billable: false }, { clearDraft: true });
  const done = await again.getSession(s.id);
  assert.equal(done.description, 'Klart');
  assert.equal(done.billable, false);
  assert.equal(await again.getDraft(s.id), null);
  assert.equal(workedMs(done, 0), 45 * MIN);
});

test('rättad sluttid för glömt pass', async () => {
  const { store, p, clock } = await withProject();
  const s = await store.startSession(p.id);
  clock.t += 30 * 3600000;
  const done = await store.stopSession(s.id, { endAt: ms('2026-09-29', '11:15') });
  assert.equal(workedMs(done, 0), 135 * MIN);
});

test('manuellt pass och tidskorrigering (uppmätt tid bevaras)', async () => {
  const { store, p, clock } = await withProject();
  const m = await store.addManualSession({ projectId: p.id, date: '2026-09-28', start: '13:00', durationMs: 90 * MIN, description: 'Möte' });
  assert.equal(m.origin, 'manual');
  await assert.rejects(() => store.addManualSession({ projectId: p.id, date: '2026-09-28', start: '13:00', durationMs: 0 }), /längre än 0/);
  await assert.rejects(() => store.addManualSession({ projectId: '', date: '2026-09-28', start: '13:00', durationMs: MIN }), /projekt/);
  assert.equal((await store.getSessions()).length, 1); // ogiltiga försök sparade inget
  const t = await store.startSession(p.id);
  clock.t += 47 * MIN;
  await store.stopSession(t.id);
  const c = await store.updateSession(t.id, { time: { date: '2026-09-29', start: '08:00', durationMs: 60 * MIN } });
  assert.equal(c.corrected, true);
  assert.equal(workedMs(c, 0), 60 * MIN);
  assert.equal(workedMs({ segments: c.measuredSegments }, 0), 47 * MIN);
  // ändra projekt och debiterbarhet
  const p2 = await store.createProject({ name: 'B', client: 'Acme' });
  const u = await store.updateSession(t.id, { projectId: p2.id, billable: false });
  assert.equal(u.projectId, p2.id);
  assert.equal(u.billable, false);
});

test('ta bort pass; upprepad borttagning skapar inget fel; aktivt pass kan inte tas bort', async () => {
  const { store, p } = await withProject();
  const m = await store.addManualSession({ projectId: p.id, date: '2026-09-28', start: '13:00', durationMs: 60 * MIN });
  assert.equal(await store.deleteSession(m.id), true);
  assert.equal(await store.deleteSession(m.id), false);
  const s = await store.startSession(p.id);
  await assert.rejects(() => store.deleteSession(s.id), /Stoppa/);
});

test('säkerhetskopia: rundtur och atomär återställning', async () => {
  const a = await withProject();
  await a.store.addManualSession({ projectId: a.p.id, date: '2026-09-28', start: '13:00', durationMs: 60 * MIN, description: 'x', privateNotes: 'privat' });
  const backup = makeBackup(await a.store.exportAll(), a.clock.t);
  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.containsPrivateData, true);
  const v = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.summary.sessions, 1);

  const b = await makeStore();
  await b.store.createProject({ name: 'Gammal', client: 'Gammal' });
  await b.store.replaceAll(v.data);
  const ps = await b.store.getProjects();
  assert.deepEqual(ps.map((p) => p.name), ['Webb']);
  assert.equal((await b.store.getSessions())[0].privateNotes, 'privat');
});

test('återställning avvisas medan timer är aktiv och ändrar då ingenting', async () => {
  const a = await withProject();
  const backup = makeBackup(await a.store.exportAll(), a.clock.t);
  const b = await withProject();
  await b.store.startSession(b.p.id);
  const v = validateBackup(backup);
  await assert.rejects(() => b.store.replaceAll(v.data), /Stoppa timern/);
  assert.equal((await b.store.getProjects()).length, 1);
  assert.ok(await b.store.getActive());
});

test('ogiltiga filer avvisas utan att något ändras', async () => {
  const a = await withProject();
  await a.store.addManualSession({ projectId: a.p.id, date: '2026-09-28', start: '13:00', durationMs: 60 * MIN });
  const good = JSON.parse(JSON.stringify(makeBackup(await a.store.exportAll(), a.clock.t)));
  const bad = (mut) => { const c = JSON.parse(JSON.stringify(good)); mut(c); return validateBackup(c); };

  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([]).ok, false);
  assert.equal(validateBackup({ app: 'annan-app' }).ok, false);
  assert.equal(bad((c) => { c.formatVersion = 99; }).ok, false);
  assert.match(bad((c) => { c.formatVersion = 99; }).errors[0], /nyare/);
  assert.equal(bad((c) => { delete c.data.sessions; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions[0].projectId = 'finns-inte'; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions[0].segments[0].end = c.data.sessions[0].segments[0].start - 1; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions[0].segments = []; }).ok, false);
  assert.equal(bad((c) => { c.data.projects[0].name = ''; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions[0].status = 'nåt'; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions.push({ ...c.data.sessions[0] }); }).ok, false); // dubblettid
  assert.equal(bad((c) => { c.data.sessions[0].segments[0].start = 'igår'; }).ok, false);
  assert.equal(bad((c) => { c.data.sessions[0].status = 'paused'; c.data.sessions[0].segments[0].end = null; }).ok, false);
  assert.ok(bad((c) => {}).ok);

  // Lagringen är orörd när valideringen faller
  const target = await withProject();
  const before = JSON.stringify(await target.store.exportAll());
  const v = bad((c) => { c.data.projects[0].id = ''; });
  assert.equal(v.ok, false);
  assert.equal(JSON.stringify(await target.store.exportAll()), before);
});

test('replaceAll är atomär: fel mitt i skrivningen lämnar gamla data orörda', async () => {
  const a = await withProject();
  const before = JSON.stringify(await a.store.exportAll());
  const poison = { projects: [{ id: 'x', name: 'n', client: 'c' }], sessions: [{ projectId: 'x' /* saknar keyPath id */ }], drafts: {} };
  await assert.rejects(() => a.store.replaceAll(poison));
  assert.equal(JSON.stringify(await a.store.exportAll()), before);
});
