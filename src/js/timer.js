// Ren timerlogik utan lagring och gränssnitt. Alla funktioner returnerar nya objekt.
// Ett pass har arbetssegment [{start, end|null}]. Arbetstid = summan av segmenten; pauser ligger mellan dem.
// Visningen räknar alltid från sparade tidsstämplar – aldrig från en löpande räknare.
import { AppError } from './errors.js';
import { isValidDate, isValidTime, localToMs } from './time.js';

export const HOUR = 3600000;
export const FORGOTTEN_RUNNING_MS = 10 * HOUR; // pågående segment längre än så flaggas
export const FORGOTTEN_PAUSED_MS = 12 * HOUR; // pausat längre än så flaggas
export const MAX_DURATION_MS = 24 * HOUR;

export function newSession({ id, projectId, now }) {
  return {
    id, projectId,
    status: 'running',
    origin: 'timer',
    segments: [{ start: now, end: null }],
    description: '',
    privateNotes: '',
    billable: true,
    corrected: false,
    measuredSegments: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function workedMs(session, now) {
  let sum = 0;
  for (const s of session.segments) {
    const end = s.end == null ? now : s.end;
    sum += Math.max(0, end - s.start);
  }
  return sum;
}

export function lastSegment(session) {
  return session.segments[session.segments.length - 1];
}

export function pause(session, now) {
  if (session.status !== 'running') return session; // idempotent
  const segs = session.segments.map((s) => ({ ...s }));
  const last = segs[segs.length - 1];
  last.end = Math.max(now, last.start);
  return { ...session, status: 'paused', segments: segs, updatedAt: now };
}

export function resume(session, now) {
  if (session.status !== 'paused') return session; // idempotent
  const prevEnd = lastSegment(session).end;
  return {
    ...session,
    status: 'running',
    segments: [...session.segments.map((s) => ({ ...s })), { start: Math.max(now, prevEnd), end: null }],
    updatedAt: now,
  };
}

/**
 * Avslutar passet. Utan endAt stängs det öppna segmentet vid "nu". Med endAt (granskning av glömt pass)
 * kapas arbetssegmenten vid den tiden. Redan avslutat pass returneras oförändrat.
 */
export function stop(session, now, endAt) {
  if (session.status === 'completed') return session;
  let segs = session.segments.map((s) => ({ ...s }));
  if (endAt != null) {
    const cap = session.status === 'paused' ? lastSegment(session).end : now;
    if (!Number.isFinite(endAt) || endAt > cap) {
      throw new AppError('INVALID', 'Sluttiden får inte ligga efter passets senaste aktivitet eller i framtiden.');
    }
    if (endAt <= segs[0].start) throw new AppError('INVALID', 'Sluttiden måste ligga efter passets start.');
    segs = segs.filter((s) => s.start < endAt).map((s) => ({ start: s.start, end: Math.min(s.end == null ? endAt : s.end, endAt) }));
  } else {
    const last = segs[segs.length - 1];
    if (last.end == null) last.end = Math.max(now, last.start);
  }
  return { ...session, status: 'completed', segments: segs, updatedAt: now };
}

/** Verkar passet ha glömts igång? Vi föreslår bara granskning – inget stoppas automatiskt. */
export function looksForgotten(session, now) {
  if (session.status === 'completed') return false;
  const last = lastSegment(session);
  if (session.status === 'running') return now - last.start >= FORGOTTEN_RUNNING_MS;
  return now - last.end >= FORGOTTEN_PAUSED_MS;
}

/** Bygger ett segment av datum + starttid + längd. Validerar allt inför lagring. */
export function segmentFromInput({ date, start, durationMs }, now) {
  if (!isValidDate(date)) throw new AppError('INVALID', 'Ange ett giltigt datum.');
  if (!isValidTime(start)) throw new AppError('INVALID', 'Ange en giltig starttid (HH:MM).');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new AppError('INVALID', 'Tiden måste vara längre än 0 minuter.');
  if (durationMs > MAX_DURATION_MS) throw new AppError('INVALID', 'Ett pass kan vara högst 24 timmar. Dela upp längre tid på flera pass.');
  const s = localToMs(date, start);
  const e = s + durationMs;
  if (e > now + 60000) throw new AppError('INVALID', 'Tiden kan inte ligga i framtiden.');
  return { start: s, end: e };
}

export function parseDuration(hoursStr, minutesStr) {
  const h = String(hoursStr ?? '').trim() === '' ? 0 : Number(hoursStr);
  const m = String(minutesStr ?? '').trim() === '' ? 0 : Number(minutesStr);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) {
    throw new AppError('INVALID', 'Timmar och minuter måste vara hela tal som inte är negativa.');
  }
  if (m > 59) throw new AppError('INVALID', 'Minuter måste vara mellan 0 och 59.');
  return (h * 60 + m) * 60000;
}

/** Ersätter ett avslutat pass tid. Timerpass behåller den ursprungligen uppmätta tiden i measuredSegments. */
export function withCorrectedTime(session, input, now) {
  const seg = segmentFromInput(input, now);
  const isTimer = session.origin === 'timer';
  return {
    ...session,
    segments: [seg],
    corrected: isTimer ? true : session.corrected,
    measuredSegments: isTimer ? (session.measuredSegments ?? session.segments.map((s) => ({ ...s }))) : null,
    updatedAt: now,
  };
}

export function newManualSession({ id, projectId, date, start, durationMs, description, privateNotes, billable, now }) {
  const seg = segmentFromInput({ date, start, durationMs }, now);
  return {
    id, projectId,
    status: 'completed',
    origin: 'manual',
    segments: [seg],
    description: description ?? '',
    privateNotes: privateNotes ?? '',
    billable: billable !== false,
    corrected: false,
    measuredSegments: null,
    createdAt: now,
    updatedAt: now,
  };
}
