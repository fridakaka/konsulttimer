import { h, field, checkbox, showError, guarded, toast } from './dom.js';
import { formatDuration, longDate } from '../format.js';
import { sessionMs, sessionStartMs } from '../report.js';
import { dayKey } from '../time.js';

/** Arbetsanteckning efter passet. Tiden är redan sparad; formuläret kan avbrytas utan följder. */
export async function noteView(ctx, root, [id]) {
  const [session, projects, draft] = await Promise.all([ctx.store.getSession(id), ctx.store.getProjects(), ctx.store.getDraft(id)]);
  if (!session) return notFound(root);
  const project = projects.find((p) => p.id === session.projectId);
  const start = draft ?? { description: session.description, privateNotes: session.privateNotes, billable: session.billable };
  const errBox = h('div');
  const desc = h('textarea', { id: 'description', value: start.description, maxlength: '20000' });
  const priv = h('textarea', { id: 'private-notes', value: start.privateNotes, maxlength: '20000' });
  const bill = checkbox('Debiterbar tid', start.billable, { id: 'billable' });
  const collect = () => ({ description: desc.value, privateNotes: priv.value, billable: bill.input.checked });

  let timer;
  const saveDraft = () => { clearTimeout(timer); return ctx.store.saveDraft(id, collect()).catch(() => {}); };
  const later = () => { clearTimeout(timer); timer = setTimeout(saveDraft, 300); };
  [desc, priv].forEach((el) => el.addEventListener('input', later));
  bill.input.addEventListener('change', later);
  window.addEventListener('pagehide', saveDraft, { once: true });

  const save = guarded(async () => {
    try {
      clearTimeout(timer);
      await ctx.store.updateSession(id, collect(), { clearDraft: true });
      toast('Sparat.');
      ctx.navigate('#/historik');
    } catch (e) { showError(errBox, e); } // formuläret behålls
  });

  root.replaceChildren(h('div', null,
    h('h1', null, 'Arbetsanteckning'),
    h('div', { class: 'card' },
      h('div', { class: 'row spread' },
        h('div', null, h('strong', null, project ? project.name : 'Okänt projekt'), h('div', { class: 'muted' }, project ? project.client : '')),
        h('div', { style: 'text-align:right' }, h('strong', { id: 'note-duration' }, formatDuration(sessionMs(session, 0))), h('div', { class: 'muted' }, longDate(dayKey(sessionStartMs(session))))))),
    h('div', { class: 'card', style: 'background:var(--primary-soft)' }, h('strong', null, 'Tiden är sparad. '), 'Du kan skriva anteckningen nu eller fylla i den senare från historiken.'),
    errBox,
    h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Vad arbetade du med?', desc, 'Texten visas i kundunderlaget.'),
      field('Privata anteckningar', priv, 'Valfritt. Följer inte med till kunden, varken i visning, utskrift eller CSV.'),
      bill.el,
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { type: 'submit', class: 'btn primary', id: 'note-save' }, 'Spara'),
        h('button', { type: 'button', class: 'btn quiet', id: 'note-later', onclick: async () => { await saveDraft(); ctx.navigate('#/historik'); } }, 'Fyll i senare')))));
  desc.focus();
}

export function notFound(root) {
  root.replaceChildren(h('div', { class: 'card empty' }, h('h2', null, 'Passet hittades inte'), h('p', null, 'Det kan ha tagits bort.'), h('a', { class: 'btn primary', href: '#/historik' }, 'Till historiken')));
}
