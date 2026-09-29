import { h, field, option } from './dom.js';
import { formatDuration } from '../format.js';
import { sessionMs, sessionStartMs } from '../report.js';
import { dayKey } from '../time.js';

let filter = { projectId: '', from: '', to: '', missingOnly: false };

export async function historyView(ctx, root) {
  const [projects, sessions] = await Promise.all([ctx.store.getProjects(), ctx.store.getSessions()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const done = sessions.filter((s) => s.status === 'completed');
  const list = h('div');
  const summary = h('p', { class: 'muted', id: 'history-summary' });

  const proj = h('select', { id: 'f-project' }, option('', 'Alla projekt', !filter.projectId),
    ...projects.map((p) => option(p.id, `${p.name} – ${p.client}${p.archived ? ' (arkiverat)' : ''}`, filter.projectId === p.id)));
  const from = h('input', { type: 'date', id: 'f-from', value: filter.from });
  const to = h('input', { type: 'date', id: 'f-to', value: filter.to });
  const missing = h('input', { type: 'checkbox', id: 'f-missing', checked: filter.missingOnly });

  const paint = () => {
    filter = { projectId: proj.value, from: from.value, to: to.value, missingOnly: missing.checked };
    // Datumfiltret utgår från passets startdag (Stockholm).
    const rows = done
      .filter((s) => !filter.projectId || s.projectId === filter.projectId)
      .filter((s) => !filter.from || dayKey(sessionStartMs(s)) >= filter.from)
      .filter((s) => !filter.to || dayKey(sessionStartMs(s)) <= filter.to)
      .filter((s) => !filter.missingOnly || !s.description.trim())
      .sort((a, b) => sessionStartMs(b) - sessionStartMs(a));
    const total = rows.reduce((a, s) => a + sessionMs(s, 0), 0);
    summary.textContent = `${rows.length} ${rows.length === 1 ? 'pass' : 'pass'}, ${formatDuration(total)} totalt`;
    if (done.length === 0) {
      list.replaceChildren(h('div', { class: 'card empty' }, h('h2', null, 'Inga pass ännu'), h('p', null, 'Starta timern eller lägg till tid manuellt så dyker passen upp här.'),
        h('a', { class: 'btn primary', href: '#/' }, 'Till timern')));
      summary.textContent = '';
      return;
    }
    if (rows.length === 0) { list.replaceChildren(h('div', { class: 'card empty' }, h('p', null, 'Inga pass matchar filtret.'))); return; }
    list.replaceChildren(h('ul', { class: 'list' }, rows.map((s) => {
      const p = byId.get(s.projectId);
      const hasDesc = s.description.trim() !== '';
      return h('li', null, h('a', { class: 'item', href: `#/pass/${s.id}`, 'data-session': s.id },
        h('div', { class: 'top' }, h('span', null, dayKey(sessionStartMs(s))), h('span', null, formatDuration(sessionMs(s, 0)))),
        h('div', null, `${p ? p.name : 'Okänt projekt'} · ${p ? p.client : ''}`),
        hasDesc ? h('div', { class: 'desc' }, s.description) : null,
        h('div', { class: 'badges' },
          hasDesc ? null : h('span', { class: 'badge warn' }, 'Saknar arbetsbeskrivning'),
          s.billable ? null : h('span', { class: 'badge' }, 'Ej debiterbar'),
          s.origin === 'manual' ? h('span', { class: 'badge' }, 'Manuellt') : null,
          s.corrected ? h('span', { class: 'badge' }, 'Tidskorrigerad') : null,
          s.billable ? h('span', { class: 'badge' }, 'Debiterbar') : null)));
    })));
  };
  [proj, from, to, missing].forEach((el) => el.addEventListener('change', paint));

  root.replaceChildren(h('div', null,
    h('div', { class: 'row spread' }, h('h1', null, 'Historik'), h('a', { class: 'btn', href: '#/nytt-pass', id: 'add-manual' }, 'Lägg till pass')),
    h('div', { class: 'card' },
      field('Projekt', proj),
      h('div', { class: 'grid2' }, field('Från och med', from), field('Till och med', to)),
      h('label', { class: 'check', for: 'f-missing' }, missing, h('span', null, 'Bara pass som saknar arbetsbeskrivning'))),
    summary, list));
  paint();
}

