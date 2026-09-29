// Kalenderlogik i Europe/Stockholm. Tidsstämplar lagras alltid som epok-millisekunder (UTC);
// kalenderdatum (YYYY-MM-DD) räknas fram först när något ska visas eller rapporteras.
export const TZ = 'Europe/Stockholm';
const HOUR = 3600000;

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function parts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** Stockholms UTC-förskjutning (ms) vid en given tidpunkt. */
export function tzOffsetMs(ms) {
  const p = parts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Kalenderdatum i Stockholm för en tidsstämpel. */
export function dayKey(ms) {
  const p = parts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Klockslag HH:MM i Stockholm. */
export function timeOfDay(ms) {
  const p = parts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Stockholm-datum och klockslag till tidsstämpel. Icke-existerande tid (vårens hopp) flyttas framåt. */
export function localToMs(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess);
  return guess - tzOffsetMs(first);
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function dayStartMs(date) {
  return localToMs(date, '00:00');
}

/**
 * Delar [start, end) vid Stockholms midnätter. Dygn med sommartid blir 23 eller 25 timmar långa.
 * Returnerar [{day, ms}] i tidsordning.
 */
export function splitByDay(start, end) {
  const out = [];
  let cur = start;
  while (cur < end) {
    const day = dayKey(cur);
    const next = dayStartMs(addDays(day, 1));
    const segEnd = Math.min(end, next);
    out.push({ day, ms: segEnd - cur });
    cur = segEnd;
  }
  return out;
}

/** Första och sista dag i månaden (Stockholm) med förskjutning i månader från "nu". */
export function monthRange(nowMs, offset = 0) {
  const [y, m] = dayKey(nowMs).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  const f = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  return { from: f(first), to: f(last) };
}

export { HOUR };
