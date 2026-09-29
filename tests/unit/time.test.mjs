import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, localToMs, splitByDay, addDays, monthRange, timeOfDay, isValidDate, isValidTime } from '../../src/js/time.js';
import { formatDuration, decimalHours, formatClock, formatHmm } from '../../src/js/format.js';

test('localToMs och dayKey är varandras invers, även med sommartid', () => {
  assert.equal(localToMs('2026-01-15', '12:00'), Date.UTC(2026, 0, 15, 11, 0)); // CET = UTC+1
  assert.equal(localToMs('2026-07-15', '12:00'), Date.UTC(2026, 6, 15, 10, 0)); // CEST = UTC+2
  for (const d of ['2026-03-29', '2026-10-25', '2026-12-31']) {
    assert.equal(dayKey(localToMs(d, '00:00')), d);
    assert.equal(dayKey(localToMs(d, '23:59')), d);
    assert.equal(timeOfDay(localToMs(d, '13:37')), '13:37');
  }
});

test('kalenderdatum följer Stockholm, inte UTC', () => {
  // 23:30 UTC 30 juni är 01:30 den 1 juli i Stockholm
  assert.equal(dayKey(Date.UTC(2026, 5, 30, 23, 30)), '2026-07-01');
});

test('pass över midnatt delas på rätt dagar', () => {
  const s = localToMs('2026-09-29', '23:00');
  const e = localToMs('2026-09-30', '01:30');
  assert.deepEqual(splitByDay(s, e), [
    { day: '2026-09-29', ms: 3600000 },
    { day: '2026-09-30', ms: 5400000 },
  ]);
});

test('månadsgräns delas och summerar till hela längden', () => {
  const s = localToMs('2026-08-31', '22:00');
  const e = localToMs('2026-09-01', '03:00');
  const p = splitByDay(s, e);
  assert.deepEqual(p.map((x) => x.day), ['2026-08-31', '2026-09-01']);
  assert.equal(p.reduce((a, x) => a + x.ms, 0), e - s);
});

test('sommartidsgräns: dygnet är 23 respektive 25 timmar', () => {
  // Vårens skifte 2026-03-29: 02:00 -> 03:00
  const spring = splitByDay(localToMs('2026-03-28', '23:00'), localToMs('2026-03-30', '01:00'));
  assert.deepEqual(spring.map((x) => [x.day, x.ms / 3600000]), [['2026-03-28', 1], ['2026-03-29', 23], ['2026-03-30', 1]]);
  // Höstens skifte 2026-10-25: 03:00 -> 02:00
  const fall = splitByDay(localToMs('2026-10-24', '23:00'), localToMs('2026-10-26', '01:00'));
  assert.deepEqual(fall.map((x) => [x.day, x.ms / 3600000]), [['2026-10-24', 1], ['2026-10-25', 25], ['2026-10-26', 1]]);
});

test('pass som spänner över vårens sommartidsskifte får rätt verklig längd', () => {
  const s = localToMs('2026-03-29', '01:00');
  const e = localToMs('2026-03-29', '04:00');
  assert.equal((e - s) / 3600000, 2); // en timme "saknas"
});

test('addDays och monthRange', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const now = localToMs('2026-01-10', '12:00');
  assert.deepEqual(monthRange(now, 0), { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(monthRange(now, -1), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(monthRange(localToMs('2026-03-05', '12:00'), -1), { from: '2026-02-01', to: '2026-02-28' });
});

test('datum- och tidsvalidering', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate(''));
  assert.ok(isValidTime('00:00') && isValidTime('23:59'));
  assert.ok(!isValidTime('24:00') && !isValidTime('9:00'));
});

test('formatering: 1 h 30 min = 1,50 h', () => {
  assert.equal(formatDuration(5400000), '1 h 30 min');
  assert.equal(decimalHours(5400000), '1,50');
  assert.equal(formatDuration(45 * 60000), '45 min');
  assert.equal(formatDuration(0), '0 min');
  assert.equal(decimalHours(20 * 60000), '0,33');
  assert.equal(formatHmm(5400000), '1:30');
  assert.equal(formatClock(3723000), '01:02:03');
  assert.equal(formatDuration(89 * 60000 + 40000), '1 h 30 min'); // avrundar bara visningen
});
