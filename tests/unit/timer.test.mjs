import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/js/timer.js';
import { ms } from './helpers.mjs';

const t0 = ms('2026-09-29', '09:00');
const MIN = 60000;

test('arbetstid räknas från tidsstämplar; pauser ingår inte', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.pause(s, t0 + 30 * MIN);
  s = T.resume(s, t0 + 45 * MIN); // 15 min paus
  assert.equal(T.workedMs(s, t0 + 60 * MIN), 45 * MIN);
  s = T.stop(s, t0 + 75 * MIN);
  assert.equal(s.status, 'completed');
  assert.equal(T.workedMs(s, t0 + 999 * MIN), 60 * MIN); // "nu" spelar ingen roll efter stopp
});

test('paustid räknas inte även om appen varit stängd länge', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.pause(s, t0 + 10 * MIN);
  assert.equal(T.workedMs(s, t0 + 5 * 3600000), 10 * MIN);
});

test('pausa/fortsätt/stoppa är idempotenta', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  const p1 = T.pause(s, t0 + MIN);
  assert.equal(T.pause(p1, t0 + 2 * MIN), p1);
  assert.equal(T.resume(s, t0 + MIN), s); // redan igång
  const done = T.stop(p1, t0 + 3 * MIN);
  assert.equal(T.stop(done, t0 + 9 * MIN), done);
  assert.equal(T.workedMs(done, t0 + 9 * MIN), MIN);
});

test('klockan som går bakåt ger aldrig negativ tid', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.stop(s, t0 - 5 * MIN);
  assert.equal(T.workedMs(s, t0), 0);
});

test('glömt pass upptäcks men stoppas inte automatiskt', () => {
  const s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  assert.ok(!T.looksForgotten(s, t0 + 9 * 3600000));
  assert.ok(T.looksForgotten(s, t0 + 10 * 3600000));
  assert.equal(s.status, 'running');
  const p = T.pause(s, t0 + MIN);
  assert.ok(!T.looksForgotten(p, t0 + 5 * 3600000));
  assert.ok(T.looksForgotten(p, t0 + 13 * 3600000));
});

test('rättad sluttid kapar segmenten, även med pauser', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.pause(s, t0 + 60 * MIN);
  s = T.resume(s, t0 + 120 * MIN);
  const now = t0 + 20 * 3600000;
  const done = T.stop(s, now, t0 + 150 * MIN);
  assert.equal(T.workedMs(done, now), 90 * MIN);
  const early = T.stop(s, now, t0 + 30 * MIN); // före pausen: bara första segmentet, kapat
  assert.equal(early.segments.length, 1);
  assert.equal(T.workedMs(early, now), 30 * MIN);
  assert.throws(() => T.stop(s, now, now + MIN), /framtiden|senaste/);
  assert.throws(() => T.stop(s, now, t0), /efter passets start/);
});

test('paus: sluttid får inte ligga efter pausen', () => {
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.pause(s, t0 + 60 * MIN);
  assert.throws(() => T.stop(s, t0 + 5 * 3600000, t0 + 90 * MIN));
  assert.equal(T.workedMs(T.stop(s, t0 + 5 * 3600000, t0 + 40 * MIN), 0), 40 * MIN);
});

test('varaktighet och manuell inmatning valideras', () => {
  assert.equal(T.parseDuration('1', '30'), 90 * MIN);
  assert.equal(T.parseDuration('', '45'), 45 * MIN);
  assert.throws(() => T.parseDuration('-1', '0'), /inte är negativa/);
  assert.throws(() => T.parseDuration('1', '60'), /0 och 59/);
  assert.throws(() => T.parseDuration('1.5', '0'), /hela tal/);
  assert.throws(() => T.parseDuration('abc', '0'));
  const now = ms('2026-09-29', '15:00');
  const ok = { date: '2026-09-29', start: '09:00', durationMs: 60 * MIN };
  assert.doesNotThrow(() => T.segmentFromInput(ok, now));
  assert.throws(() => T.segmentFromInput({ ...ok, date: '2026-02-30' }, now), /datum/);
  assert.throws(() => T.segmentFromInput({ ...ok, start: '25:00' }, now), /starttid/);
  assert.throws(() => T.segmentFromInput({ ...ok, durationMs: 0 }, now), /längre än 0/);
  assert.throws(() => T.segmentFromInput({ ...ok, durationMs: -5 }, now));
  assert.throws(() => T.segmentFromInput({ ...ok, durationMs: 25 * 3600000 }, now), /24 timmar/);
  assert.throws(() => T.segmentFromInput({ ...ok, date: '2026-09-30' }, now), /framtiden/);
});

test('tidskorrigering bevarar ursprungligt uppmätt tid, även vid upprepad korrigering', () => {
  const now = ms('2026-09-29', '18:00');
  let s = T.newSession({ id: 'a', projectId: 'p', now: t0 });
  s = T.stop(s, t0 + 47 * MIN);
  const c1 = T.withCorrectedTime(s, { date: '2026-09-29', start: '09:00', durationMs: 60 * MIN }, now);
  assert.ok(c1.corrected);
  assert.equal(T.workedMs(c1, now), 60 * MIN);
  assert.equal(T.workedMs({ segments: c1.measuredSegments }, now), 47 * MIN);
  const c2 = T.withCorrectedTime(c1, { date: '2026-09-29', start: '09:00', durationMs: 90 * MIN }, now);
  assert.equal(T.workedMs({ segments: c2.measuredSegments }, now), 47 * MIN);
});

test('manuellt pass markeras som manuellt', () => {
  const s = T.newManualSession({ id: 'm', projectId: 'p', date: '2026-09-28', start: '10:00', durationMs: 2 * 3600000, now: ms('2026-09-29', '12:00') });
  assert.equal(s.origin, 'manual');
  assert.equal(s.status, 'completed');
  assert.equal(s.billable, true);
  assert.equal(T.workedMs(s, 0), 2 * 3600000);
});
