// Presentation av tid. Beräkningar sker alltid på exakta millisekunder; avrundning görs bara här.
const MIN = 60000;
const HOUR = 3600000;

/** Avrundat till hela minuter, t.ex. "1 h 30 min". */
export function formatDuration(ms) {
  const total = Math.round(ms / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Decimaltimmar med två decimaler och decimalkomma, t.ex. "1,50". */
export function decimalHours(ms, decimals = 2) {
  return (ms / HOUR).toFixed(decimals).replace('.', ',');
}

/** Klocka för timern, HH:MM:SS. */
export function formatClock(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** H:MM (avrundat till minut) för CSV. */
export function formatHmm(ms) {
  const total = Math.round(ms / MIN);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function splitHoursMinutes(ms) {
  const total = Math.round(ms / MIN);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

const dateFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
/** "tisdag 29 september 2026" från YYYY-MM-DD. */
export function longDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}
