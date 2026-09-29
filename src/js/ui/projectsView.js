import { h, field, showError, openDialog, guarded, toast } from './dom.js';

export async function projectsView(ctx, root) {
  const projects = await ctx.store.getProjects();
  const clients = [...new Set(projects.map((p) => p.client.trim()))].sort((a, b) => a.localeCompare(b, 'sv'));
  const errBox = h('div');
  const byName = (a, b) => (a.client + a.name).localeCompare(b.client + b.name, 'sv');
  const activeList = projects.filter((p) => !p.archived).sort(byName);
  const archived = projects.filter((p) => p.archived).sort(byName);

  const name = h('input', { type: 'text', id: 'p-name', autocomplete: 'off', maxlength: '200' });
  const client = h('input', { type: 'text', id: 'p-client', autocomplete: 'off', list: 'client-list', maxlength: '200' });
  const add = guarded(async () => {
    try {
      await ctx.store.createProject({ name: name.value, client: client.value });
      toast('Projektet skapades.');
      ctx.rerender();
    } catch (e) { showError(errBox, e); }
  });

  const row = (p) => h('li', null, h('div', { class: 'item' },
    h('div', { class: 'top' }, h('span', null, p.name)),
    h('div', { class: 'muted' }, p.client),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { type: 'button', class: 'btn quiet', 'data-action': 'edit', onclick: () => editDialog(ctx, p).then((ok) => ok && ctx.rerender()) }, 'Redigera'),
      h('button', {
        type: 'button', class: 'btn quiet', 'data-action': p.archived ? 'restore' : 'archive',
        onclick: guarded(async () => {
          try { await ctx.store.setArchived(p.id, !p.archived); toast(p.archived ? 'Projektet är aktivt igen.' : 'Projektet arkiverades. Historiken finns kvar.'); ctx.rerender(); } catch (e) { showError(errBox, e); }
        }),
      }, p.archived ? 'Återaktivera' : 'Arkivera'))));

  root.replaceChildren(h('div', null,
    h('h1', null, 'Projekt'),
    errBox,
    h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); add(); } },
      h('h2', { style: 'margin-top:0' }, 'Nytt projekt'),
      field('Projektnamn', name), field('Kundnamn', client, 'Skriv exakt samma kundnamn på alla projekt för samma kund.'),
      h('datalist', { id: 'client-list' }, clients.map((c) => h('option', { value: c }))),
      h('button', { type: 'submit', class: 'btn primary', id: 'p-add' }, 'Skapa projekt')),
    activeList.length ? h('ul', { class: 'list', 'aria-label': 'Aktiva projekt' }, activeList.map(row))
      : h('div', { class: 'card empty' }, h('p', null, 'Inga aktiva projekt ännu. Skapa ditt första ovan.')),
    archived.length ? h('div', null, h('h2', null, 'Arkiverade'), h('p', { class: 'muted small' }, 'Visas inte vid nya pass, men finns kvar i historik och kundunderlag.'), h('ul', { class: 'list', 'aria-label': 'Arkiverade projekt' }, archived.map(row))) : null));
}

function editDialog(ctx, p) {
  return openDialog((dlg, close) => {
    const errBox = h('div');
    const name = h('input', { type: 'text', id: 'e-name', value: p.name, maxlength: '200' });
    const client = h('input', { type: 'text', id: 'e-client', value: p.client, maxlength: '200' });
    dlg.append(h('h2', null, 'Redigera projekt'), errBox, field('Projektnamn', name), field('Kundnamn', client),
      h('p', { class: 'muted small' }, 'Ändringen gäller även tidigare pass i historik och kundunderlag.'),
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(false) }, 'Avbryt'),
        h('button', {
          type: 'button', class: 'btn primary', id: 'e-save',
          onclick: guarded(async () => { try { await ctx.store.updateProject(p.id, { name: name.value, client: client.value }); close(true); } catch (e) { showError(errBox, e); } }),
        }, 'Spara')));
  });
}
