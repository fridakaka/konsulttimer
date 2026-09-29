import { h, field, checkbox, option, showError, guarded, toast, confirmDialog } from './dom.js';
import { formatDuration, splitHoursMinutes } from '../format.js';
import { parseDuration, workedMs } from '../timer.js';
import { dayKey, timeOfDay } from '../time.js';
import { sessionMs } from '../report.js';
import { notFound } from './noteView.js';

/** Redigera ett sparat pass (id) eller lägg till ett manuellt (inget id). */
export async function sessionFormView(ctx, root, [id]) {
  const isNew = !id;
  const [projects, session] = await Promise.all([ctx.store.getProjects(), isNew ? null : ctx.store.getSession(id)]);
  if (!isNew && !session) return notFound(root);
  if (session && session.status !== 'completed') {
    root.replaceChildren(h('div', { class: 'card empty' }, h('h2', null, 'Passet pågår'), h('p', null, 'Stoppa passet på Timer-sidan innan du redigerar det.'), h('a', { class: 'btn primary', href: '#/' }, 'Till timern')));
    return;
  }
  const now = ctx.now();
  const first = session?.segments[0];
  const init = session
    ? { date: dayKey(first.start), start: timeOfDay(first.start), ...(({ hours, minutes }) => ({ h: String(hours), m: String(minutes) }))(splitHoursMinutes(sessionMs(session, now))) }
    : defaultManual(now);

  const usable = projects.filter((p) => !p.archived || (session && p.id === session.projectId));
  const proj = h('select', { id: 'project', required: true },
    option('', 'Välj projekt …', !session),
    ...usable.map((p) => option(p.id, `${p.name} – ${p.client}${p.archived ? ' (arkiverat)' : ''}`, session?.projectId === p.id)));
  const date = h('input', { type: 'date', id: 'date', value: init.date, required: true });
  const start = h('input', { type: 'time', id: 'start', value: init.start, required: true });
  const hours = h('input', { type: 'number', id: 'hours', min: '0', max: '24', step: '1', inputmode: 'numeric', value: init.h });
  const mins = h('input', { type: 'number', id: 'minutes', min: '0', max: '59', step: '1', inputmode: 'numeric', value: init.m });
  const desc = h('textarea', { id: 'description', value: session?.description ?? '', maxlength: '20000' });
  const priv = h('textarea', { id: 'private-notes', value: session?.privateNotes ?? '', maxlength: '20000' });
  const bill = checkbox('Debiterbar tid', session ? session.billable : true, { id: 'billable' });
  const errBox = h('div');

  const timeChanged = () => date.value !== init.date || start.value !== init.start || hours.value.trim() !== init.h || mins.value.trim() !== init.m;

  const save = guarded(async () => {
    try {
      if (!proj.value) throw Object.assign(new Error(), { name: 'AppError', message: 'Välj ett projekt.' });
      const durationMs = parseDuration(hours.value, mins.value);
      const fields = { projectId: proj.value, description: desc.value, privateNotes: priv.value, billable: bill.input.checked };
      if (isNew) {
        await ctx.store.addManualSession({ ...fields, date: date.value, start: start.value, durationMs });
      } else {
        // Oförändrade tidsfält lämnas orörda så att uppmätt tid (med sekunder) inte ersätts av en avrundad.
        await ctx.store.updateSession(id, { ...fields, ...(timeChanged() ? { time: { date: date.value, start: start.value, durationMs } } : {}) }, { clearDraft: true });
      }
      toast('Sparat.');
      ctx.navigate('#/historik');
    } catch (e) { showError(errBox, e); }
  });

  const measured = session?.corrected && session.measuredSegments
    ? h('div', { class: 'card', id: 'measured-note' }, h('strong', null, 'Tidskorrigerat pass. '), `Ursprungligen uppmätt tid: ${formatDuration(workedMs({ segments: session.measuredSegments }, 0))}. Kundunderlaget använder den korrigerade tiden.`)
    : null;

  const del = isNew ? null : h('button', {
    type: 'button', class: 'btn danger', id: 'delete-btn',
    onclick: guarded(async () => {
      const ok = await confirmDialog({ title: 'Ta bort passet?', body: 'Passet och dess anteckningar tas bort permanent. Det går inte att ångra.', confirmLabel: 'Ta bort', danger: true });
      if (!ok) return;
      try { await ctx.store.deleteSession(id); toast('Passet togs bort.'); ctx.navigate('#/historik'); } catch (e) { showError(errBox, e); }
    }),
  }, 'Ta bort pass');

  root.replaceChildren(h('div', null,
    h('h1', null, isNew ? 'Lägg till tid manuellt' : 'Redigera pass'),
    !isNew && session.origin === 'manual' ? h('p', { class: 'muted' }, 'Manuellt registrerat pass.') : null,
    measured, errBox,
    h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Projekt', proj),
      h('div', { class: 'grid2' }, field('Datum', date), field('Starttid', start)),
      h('div', { class: 'label' }, 'Tid'),
      h('div', { class: 'grid2' }, field('Timmar', hours), field('Minuter', mins)),
      field('Vad arbetade du med?', desc, 'Texten visas i kundunderlaget.'),
      field('Privata anteckningar', priv, 'Valfritt. Följer inte med till kunden.'),
      bill.el,
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { type: 'submit', class: 'btn primary', id: 'session-save' }, 'Spara'),
        h('a', { class: 'btn quiet', href: '#/historik' }, 'Avbryt'),
        del))));
}

/** Förslag för nytt manuellt pass: en timme som slutar nu (aldrig i framtiden). */
function defaultManual(now) {
  const hourAgo = now - 3600000;
  const sameDay = dayKey(hourAgo) === dayKey(now);
  return { date: dayKey(now), start: sameDay ? timeOfDay(hourAgo) : '00:00', h: sameDay ? '1' : '0', m: sameDay ? '0' : '30' };
}
