// Rapportberäkningar för kundunderlaget. Räknar på exakta millisekunder; privata anteckningar
// läses aldrig här – rapportraderna innehåller bara de fält som får nå kunden.
import { addDays, dayKey, splitByDay } from './time.js';

export const MISSING_TEXT = 'Arbetsbeskrivning saknas';

/** Passets tid uppdelad per kalenderdag (Stockholm): [{day, ms}]. Endast avslutade segment. */
export function dayPieces(session) {
  const byDay = new Map();
  for (const seg of session.segments) {
    if (seg.end == null || seg.end <= seg.start) continue;
    for (const p of splitByDay(seg.start, seg.end)) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.ms);
  }
  return [...byDay].map(([day, ms]) => ({ day, ms })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function sessionStartMs(session) {
  return session.segments[0]?.start ?? 0;
}

export function sessionMs(session, now) {
  let sum = 0;
  for (const s of session.segments) sum += Math.max(0, (s.end ?? now) - s.start);
  return sum;
}

/**
 * Bygger kundunderlaget.
 * @param {{sessions, projects, client:string, projectId?:string, from:string, to:string, includeNonBillable?:boolean}} o
 * from/to är inkluderande Stockholm-datum (YYYY-MM-DD).
 */
export function buildReport({ sessions, projects, client, projectId = '', from, to, includeNonBillable = false }) {
  const projById = new Map(projects.map((p) => [p.id, p]));
  const rows = [];
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    const p = projById.get(s.projectId);
    if (!p || p.client.trim() !== client) continue;
    if (projectId && s.projectId !== projectId) continue;
    if (!includeNonBillable && !s.billable) continue;
    const description = (s.description ?? '').trim();
    for (const piece of dayPieces(s)) {
      if (piece.day < from || piece.day > to) continue;
      rows.push({
        sessionId: s.id, day: piece.day, projectId: p.id, projectName: p.name, client: p.client.trim(),
        description, missing: description === '', billable: s.billable, ms: piece.ms, _start: sessionStartMs(s),
      });
    }
  }
  rows.sort((a, b) => (a.day === b.day ? a._start - b._start || (a.sessionId < b.sessionId ? -1 : 1) : a.day < b.day ? -1 : 1));
  rows.forEach((r) => delete r._start);

  let totalMs = 0;
  let billableMs = 0;
  const per = new Map();
  for (const r of rows) {
    totalMs += r.ms;
    if (r.billable) billableMs += r.ms;
    const e = per.get(r.projectId) ?? { projectId: r.projectId, name: r.projectName, ms: 0 };
    e.ms += r.ms;
    per.set(r.projectId, e);
  }
  const perProject = [...per.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const missingSessionIds = [...new Set(rows.filter((r) => r.missing).map((r) => r.sessionId))];
  const hasNonBillable = rows.some((r) => !r.billable);
  return { client, projectId, from, to, includeNonBillable, rows, totalMs, billableMs, nonBillableMs: totalMs - billableMs, perProject, missingSessionIds, hasNonBillable };
}

/** Är det lämpligt att visa en not om att summan kan avvika från de avrundade raderna? */
export function roundingDiffers(report, roundFn) {
  const sumOfRows = report.rows.reduce((a, r) => a + roundFn(r.ms), 0);
  return sumOfRows !== roundFn(report.totalMs);
}

export function todayMs(sessions, today) {
  let sum = 0;
  let count = 0;
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    const piece = dayPieces(s).find((p) => p.day === today);
    if (piece) { sum += piece.ms; count += 1; }
  }
  return { ms: sum, count };
}

export { addDays, dayKey };
