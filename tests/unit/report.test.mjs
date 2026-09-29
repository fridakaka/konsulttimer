import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, dayPieces, MISSING_TEXT, roundingDiffers, todayMs } from '../../src/js/report.js';
import { toCsv, safeText, csvField } from '../../src/js/csv.js';
import { decimalHours, formatDuration } from '../../src/js/format.js';
import { ms } from './helpers.mjs';

const H = 3600000;
const MIN = 60000;
const projects = [
  { id: 'p1', name: 'Webbplats', client: 'Acme AB', archived: false },
  { id: 'p2', name: 'Underhåll', client: 'Acme AB', archived: true },
  { id: 'p3', name: 'Rapport', client: 'Beta HB', archived: false },
];
function sess(id, projectId, segs, o = {}) {
  return {
    id, projectId, status: 'completed', origin: 'timer',
    segments: segs.map(([a, b]) => ({ start: a, end: b })),
    description: 'Gjorde saker', privateNotes: '', billable: true, corrected: false, measuredSegments: null, ...o,
  };
}

test('summering sker på exakta tider; avrundning bara i visning', () => {
  // tre pass om 20 min = exakt 1 h, men avrundade till kvartar hade blivit fel
  const a = ms('2026-09-01', '09:00');
  const sessions = [0, 1, 2].map((i) => sess(`s${i}`, 'p1', [[a + i * H, a + i * H + 20 * MIN]]));
  const r = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-30' });
  assert.equal(r.totalMs, H);
  assert.equal(decimalHours(r.totalMs), '1,00');
  assert.equal(formatDuration(r.totalMs), '1 h 00 min');
  assert.equal(decimalHours(20 * MIN), '0,33'); // rad visas avrundat …
  assert.equal(r.rows.reduce((x, y) => x + y.ms, 0), H); // … men summan är exakt
});

test('sekunder bevaras i beräkningsunderlaget', () => {
  const a = ms('2026-09-01', '09:00');
  const sessions = [sess('s1', 'p1', [[a, a + 89 * MIN + 40000]]), sess('s2', 'p1', [[a + 5 * H, a + 5 * H + 89 * MIN + 40000]])];
  const r = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01' });
  assert.equal(r.totalMs, 2 * (89 * MIN + 40000));
  assert.equal(formatDuration(r.rows[0].ms), '1 h 30 min');
  assert.equal(formatDuration(r.totalMs), '2 h 59 min'); // 179 min 20 s
  assert.equal(roundingDiffers(r, (x) => Math.round(x / MIN)), true); // 90+90 != 179
});

test('datumfilter är inkluderande i båda ändar', () => {
  const sessions = ['2026-09-09', '2026-09-10', '2026-09-15', '2026-09-16'].map((d, i) => sess(`s${i}`, 'p1', [[ms(d, '10:00'), ms(d, '11:00')]]));
  const r = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-10', to: '2026-09-15' });
  assert.deepEqual(r.rows.map((x) => x.day), ['2026-09-10', '2026-09-15']);
});

test('pass över midnatt fördelas på rätt dag och filtreras per dag', () => {
  const s = sess('s', 'p1', [[ms('2026-09-10', '23:00'), ms('2026-09-11', '02:00')]]);
  const all = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-09-10', to: '2026-09-11' });
  assert.deepEqual(all.rows.map((x) => [x.day, x.ms / H]), [['2026-09-10', 1], ['2026-09-11', 2]]);
  const only10 = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-09-10', to: '2026-09-10' });
  assert.equal(only10.totalMs, H);
  const only11 = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-09-11', to: '2026-09-11' });
  assert.equal(only11.totalMs, 2 * H);
});

test('månadsgräns: ingen dubbelräkning mellan augusti och september', () => {
  const s = sess('s', 'p1', [[ms('2026-08-31', '23:00'), ms('2026-09-01', '01:00')]]);
  const aug = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-08-01', to: '2026-08-31' });
  const sep = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-30' });
  assert.equal(aug.totalMs, H);
  assert.equal(sep.totalMs, H);
  assert.equal(aug.totalMs + sep.totalMs, 2 * H);
});

test('pausat pass som passerar midnatt delas per segment utan att paustid räknas', () => {
  const s = sess('s', 'p1', [
    [ms('2026-09-10', '22:00'), ms('2026-09-10', '23:00')],
    [ms('2026-09-11', '00:30'), ms('2026-09-11', '01:30')],
  ]);
  const p = dayPieces(s);
  assert.deepEqual(p.map((x) => [x.day, x.ms / H]), [['2026-09-10', 1], ['2026-09-11', 1]]);
});

test('sommartidsskifte i rapport: verklig tid per dygn', () => {
  const s = sess('s', 'p1', [[ms('2026-03-28', '22:00'), ms('2026-03-29', '05:00')]]);
  const r = buildReport({ sessions: [s], projects, client: 'Acme AB', from: '2026-03-28', to: '2026-03-29' });
  assert.deepEqual(r.rows.map((x) => [x.day, x.ms / H]), [['2026-03-28', 2], ['2026-03-29', 4]]); // 00–05 lokalt = 4 h verklig tid
});

test('debiterbara som standard; övrig tid markeras när den tas med', () => {
  const d = ms('2026-09-01', '10:00');
  const sessions = [sess('b', 'p1', [[d, d + H]]), sess('n', 'p1', [[d + 2 * H, d + 3 * H]], { billable: false })];
  const std = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01' });
  assert.equal(std.rows.length, 1);
  const inc = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01', includeNonBillable: true });
  assert.equal(inc.rows.length, 2);
  assert.equal(inc.nonBillableMs, H);
  assert.ok(inc.hasNonBillable);
  assert.deepEqual(inc.rows.map((r) => r.billable), [true, false]);
});

test('kund, projekt och arkiverade projekt; pågående pass utesluts', () => {
  const d = ms('2026-09-01', '10:00');
  const sessions = [
    sess('a', 'p1', [[d, d + H]]),
    sess('b', 'p2', [[d, d + 2 * H]]), // arkiverat projekt ingår i rapporter
    sess('c', 'p3', [[d, d + 4 * H]]),
    { ...sess('d', 'p1', [[d, null]]), status: 'running' },
  ];
  const all = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01' });
  assert.equal(all.totalMs, 3 * H);
  assert.deepEqual(all.perProject.map((x) => [x.name, x.ms / H]), [['Underhåll', 2], ['Webbplats', 1]]);
  const one = buildReport({ sessions, projects, client: 'Acme AB', projectId: 'p1', from: '2026-09-01', to: '2026-09-01' });
  assert.equal(one.totalMs, H);
});

test('saknad arbetsbeskrivning flaggas och får neutral text i CSV', () => {
  const d = ms('2026-09-01', '10:00');
  const sessions = [sess('a', 'p1', [[d, d + H]], { description: '   ' })];
  const r = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01' });
  assert.deepEqual(r.missingSessionIds, ['a']);
  assert.ok(toCsv(r).includes(MISSING_TEXT));
});

test('privata anteckningar når aldrig rapport eller CSV', () => {
  const d = ms('2026-09-01', '10:00');
  const SECRET = 'HEMLIG-KUNDEN-ÄR-KRÅNGLIG';
  const sessions = [sess('a', 'p1', [[d, d + H]], { privateNotes: SECRET, description: 'Offentlig text' })];
  const r = buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01', includeNonBillable: true });
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.ok(!toCsv(r).includes(SECRET));
  assert.ok(toCsv(r).includes('Offentlig text'));
});

test('CSV: svenska tecken, radbrytningar, citat, semikolon och formelskydd', () => {
  const d = ms('2026-09-01', '10:00');
  const sessions = [
    sess('a', 'p1', [[d, d + 90 * MIN]], { description: 'Åsa; "citat"\nrad två – ö' }),
    sess('b', 'p1', [[d + 2 * H, d + 3 * H]], { description: '=HYPERLINK("http://x")' }),
    sess('c', 'p1', [[d + 4 * H, d + 5 * H]], { description: '@SUM(A1)' }),
  ];
  const csv = toCsv(buildReport({ sessions, projects, client: 'Acme AB', from: '2026-09-01', to: '2026-09-01' }));
  assert.ok(csv.startsWith('Datum;Kund;Projekt;Arbetsbeskrivning;Debiterbar;Tid (h:mm);Timmar (decimal)\r\n'));
  assert.ok(csv.includes('"Åsa; ""citat""\nrad två – ö"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`)); // apostrof före formeltecken; citeras och dubblar " 
  assert.ok(csv.includes(";'@SUM(A1);"));
  assert.ok(csv.includes(';1:30;1,50\r\n'));
  assert.ok(csv.trimEnd().endsWith('Summa;;;;;3:30;3,50'));
  assert.equal(safeText('+1'), "'+1");
  assert.equal(safeText('-5'), "'-5");
  assert.equal(safeText('vanlig'), 'vanlig');
  assert.equal(csvField('a;b'), '"a;b"');
});

test('dagens registrerade tid', () => {
  const s = [
    sess('a', 'p1', [[ms('2026-09-29', '08:00'), ms('2026-09-29', '09:00')]]),
    sess('b', 'p1', [[ms('2026-09-28', '23:00'), ms('2026-09-29', '01:00')]]),
    sess('c', 'p1', [[ms('2026-09-27', '08:00'), ms('2026-09-27', '09:00')]]),
  ];
  assert.deepEqual(todayMs(s, '2026-09-29'), { ms: 2 * H, count: 2 });
});
