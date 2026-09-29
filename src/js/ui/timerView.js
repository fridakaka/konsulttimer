import { h, field, option, showError, openDialog, guarded, toast } from './dom.js';
import { formatClock, formatDuration, longDate } from '../format.js';
import { workedMs, lastSegment, looksForgotten } from '../timer.js';
import { dayKey, localToMs, timeOfDay } from '../time.js';
import { todayMs } from '../report.js';

let selectedProjectId = ''; // bara i minnet – väljs alltid aktivt av användaren

export async function timerView(ctx, root) {
  const [projects, sessions, active] = await Promise.all([ctx.store.getProjects(), ctx.store.getSessions(), ctx.store.getActive()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const now = ctx.now();
  const today = todayMs(sessions, dayKey(now));
  const errBox = h('div');
  const page = h('div', null, h('h1', null, 'Timer'), errBox);
  const fail = (e) => showError(errBox, e);

  if (active) {
    const project = byId.get(active.projectId);
    const clock = h('div', { class: 'clock', role: 'timer', 'aria-label': 'Registrerad tid' }, formatClock(workedMs(active, now)));
    const statusEl = h('span', { class: `status ${active.status === 'paused' ? 'paused' : ''}` }, active.status === 'paused' ? 'Pausad' : 'Pågår');
    const paint = () => {
      const n = ctx.now();
      clock.textContent = formatClock(workedMs(active, n));
    };
    if (active.status === 'running') ctx.setTicker(paint, 250);

    const act = (fn) => guarded(async () => {
      try { await fn(); ctx.rerender(); } catch (e) {
        if (e.code === 'ACTIVE_EXISTS' || e.code === 'NOT_FOUND') ctx.rerender(); else fail(e);
      }
    });
    const toggle = active.status === 'running'
      ? h('button', { type: 'button', class: 'btn big', id: 'pause-btn', onclick: act(() => ctx.store.pauseSession(active.id)) }, 'Pausa')
      : h('button', { type: 'button', class: 'btn big', id: 'resume-btn', onclick: act(() => ctx.store.resumeSession(active.id)) }, 'Fortsätt');
    const stopBtn = h('button', {
      type: 'button', class: 'btn big primary', id: 'stop-btn',
      onclick: guarded(async () => {
        try {
          await ctx.store.stopSession(active.id); // tiden sparas först …
          ctx.navigate(`#/anteckning/${active.id}`); // … därefter anteckningen
        } catch (e) { if (e.code === 'NOT_FOUND') ctx.rerender(); else fail(e); }
      }),
    }, 'Stoppa');

    page.append(h('section', { class: 'card timer-card', 'aria-label': 'Pågående pass' },
      statusEl,
      h('p', { class: 'proj-name' }, project ? project.name : 'Okänt projekt'),
      h('p', { class: 'muted', style: 'margin-top:0' }, project ? project.client : ''),
      clock,
      h('p', { class: 'muted small' }, `Startade ${longDate(dayKey(active.segments[0].start))} kl. ${timeOfDay(active.segments[0].start)}`),
      h('div', { class: 'row', style: 'margin-top:12px' }, toggle, stopBtn),
      h('p', { style: 'margin-top:14px' }, h('button', {
        type: 'button', class: 'btn quiet', id: 'switch-project',
        onclick: () => switchProjectDialog(ctx, active, projects).then((done) => done && ctx.rerender()).catch(fail),
      }, 'Byt projekt för passet…'))));

    if (looksForgotten(active, now)) {
      page.insertBefore(h('div', { class: 'card warn', role: 'alert', id: 'forgotten' },
        h('strong', null, 'Det här passet verkar ha glömts igång. '),
        'Inget har stoppats automatiskt. Granska passet och ange när du faktiskt slutade.',
        h('div', { style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn', onclick: () => reviewDialog(ctx, active).then((ok) => ok && ctx.navigate(`#/anteckning/${active.id}`)).catch(fail) }, 'Granska och rätta passet'))), errBox.nextSibling);
    }
  } else {
    page.append(startCard(ctx, projects, fail));
  }

  page.append(h('section', { class: 'card', 'aria-label': 'Dagens tid' },
    h('h2', { style: 'margin-top:0' }, 'Idag'),
    h('p', { style: 'margin:0' }, h('span', { style: 'font-size:1.5rem;font-weight:700' }, formatDuration(today.ms)),
      h('span', { class: 'muted' }, ` registrerad tid, ${today.count} ${today.count === 1 ? 'pass' : 'pass'}`)),
    active ? h('p', { class: 'muted small' }, 'Det pågående passet räknas in när du stoppar det.') : null,
    h('p', { style: 'margin:12px 0 0' }, h('a', { class: 'btn quiet', href: '#/nytt-pass', id: 'manual-link' }, 'Lägg till tid manuellt'))));
  root.replaceChildren(page);
}

function startCard(ctx, projects, fail) {
  const usable = projects.filter((p) => !p.archived);
  if (usable.length === 0) {
    return h('section', { class: 'card empty' },
      h('h2', { style: 'margin-top:0' }, 'Skapa ditt första projekt'),
      h('p', null, 'Du behöver ett projekt och ett kundnamn innan du kan starta timern.'),
      h('a', { class: 'btn primary', href: '#/projekt' }, 'Skapa projekt'));
  }
  if (!usable.some((p) => p.id === selectedProjectId)) selectedProjectId = '';
  const select = h('select', { id: 'project-select' },
    option('', 'Välj projekt …', selectedProjectId === ''),
    ...usable.slice().sort((a, b) => (a.client + a.name).localeCompare(b.client + b.name, 'sv'))
      .map((p) => option(p.id, `${p.name} – ${p.client}`, p.id === selectedProjectId)));
  const clientLine = h('p', { class: 'muted', id: 'client-line', style: 'margin:0 0 12px' });
  const startBtn = h('button', { type: 'button', class: 'btn big primary block', id: 'start-btn', disabled: !selectedProjectId }, 'Starta');
  const chipBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Senast använda projekt' });
  const recent = usable.filter((p) => p.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 4);

  const sync = () => {
    const p = usable.find((x) => x.id === selectedProjectId);
    select.value = selectedProjectId;
    clientLine.textContent = p ? `Kund: ${p.client}` : 'Välj vilket projekt tiden ska registreras på.';
    startBtn.disabled = !p;
    chipBox.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === selectedProjectId)));
  };
  recent.forEach((p) => chipBox.append(h('button', {
    type: 'button', class: 'chip', 'data-id': p.id, 'aria-pressed': 'false',
    onclick: () => { selectedProjectId = p.id; sync(); },
  }, p.name, ' ', h('small', null, p.client))));
  select.addEventListener('change', () => { selectedProjectId = select.value; sync(); });
  startBtn.addEventListener('click', guarded(async () => {
    if (!selectedProjectId) return;
    try {
      await ctx.store.startSession(selectedProjectId);
      selectedProjectId = '';
      ctx.rerender();
    } catch (e) { if (e.code === 'ACTIVE_EXISTS') ctx.rerender(); else fail(e); }
  }));
  const card = h('section', { class: 'card', 'aria-label': 'Starta pass' },
    recent.length ? h('div', null, h('span', { class: 'label' }, 'Senast använda'), chipBox) : null,
    field('Projekt', select), clientLine, startBtn);
  sync();
  return card;
}

/** Byte av projekt under pågående pass kräver uttryckligt val och bekräftelse. */
function switchProjectDialog(ctx, active, projects) {
  const options = projects.filter((p) => !p.archived && p.id !== active.projectId);
  return openDialog((dlg, close) => {
    const errBox = h('div');
    const sel = h('select', { id: 'switch-select' }, option('', 'Välj projekt …', true), ...options.map((p) => option(p.id, `${p.name} – ${p.client}`)));
    dlg.append(h('h2', null, 'Byt projekt för passet'),
      h('p', null, 'Hela det pågående passet, även tid som redan registrerats, flyttas till det projekt du väljer. Kontrollera att kunden är rätt.'),
      errBox, field('Nytt projekt', sel),
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(false) }, 'Avbryt'),
        h('button', {
          type: 'button', class: 'btn primary', id: 'switch-confirm',
          onclick: guarded(async () => {
            if (!sel.value) return showError(errBox, { name: 'AppError', message: 'Välj ett projekt.' });
            try { await ctx.store.changeActiveProject(active.id, sel.value); toast('Projektet byttes.'); close(true); } catch (e) { showError(errBox, e); }
          }),
        }, 'Flytta passet')));
  });
}

/** Granska ett glömt pass: användaren anger själv sluttid. Inget kortas automatiskt. */
function reviewDialog(ctx, active) {
  const last = lastSegment(active);
  const suggestion = active.status === 'paused' ? last.end : last.start;
  return openDialog((dlg, close) => {
    const errBox = h('div');
    const dateIn = h('input', { type: 'date', id: 'end-date', value: dayKey(suggestion) });
    const timeIn = h('input', { type: 'time', id: 'end-time', value: timeOfDay(suggestion) });
    dlg.append(h('h2', null, 'Granska glömt pass'),
      h('p', null, `Passet startade ${dayKey(active.segments[0].start)} kl. ${timeOfDay(active.segments[0].start)}. `,
        active.status === 'paused' ? 'Det är pausat – tiden efter pausen räknas inte.' : 'Ange när du faktiskt slutade arbeta.'),
      errBox,
      h('div', { class: 'grid2' }, field('Slutdatum', dateIn), field('Sluttid', timeIn)),
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(false) }, 'Avbryt'),
        h('button', {
          type: 'button', class: 'btn primary', id: 'review-save',
          onclick: guarded(async () => {
            try {
              const endAt = localToMs(dateIn.value, timeIn.value);
              if (!dateIn.value || !timeIn.value) throw Object.assign(new Error(), { name: 'AppError', message: 'Ange datum och tid.' });
              await ctx.store.stopSession(active.id, { endAt });
              close(true);
            } catch (e) { showError(errBox, e); }
          }),
        }, 'Stoppa vid vald tid')));
  });
}
