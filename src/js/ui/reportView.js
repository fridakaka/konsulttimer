import { h, field, checkbox, option, showError, download } from './dom.js';
import { decimalHours, formatDuration } from '../format.js';
import { buildReport, MISSING_TEXT, roundingDiffers } from '../report.js';
import { toCsvBlob } from '../csv.js';
import { monthRange } from '../time.js';

let state = null; // minns valet medan appen är öppen

export async function reportView(ctx, root) {
  const [projects, sessions] = await Promise.all([ctx.store.getProjects(), ctx.store.getSessions()]);
  const now = ctx.now();
  if (!state) state = { client: '', projectId: '', ...monthRange(now, 0), includeNonBillable: false };
  const clients = [...new Set(projects.map((p) => p.client.trim()))].sort((a, b) => a.localeCompare(b, 'sv'));
  if (!clients.includes(state.client)) state.client = '';

  if (projects.length === 0) {
    root.replaceChildren(h('div', null, h('h1', null, 'Kundunderlag'), h('div', { class: 'card empty' }, h('h2', null, 'Inget att sammanställa än'), h('p', null, 'Skapa ett projekt och registrera tid först.'), h('a', { class: 'btn primary', href: '#/projekt' }, 'Skapa projekt'))));
    return;
  }

  const clientSel = h('select', { id: 'r-client' });
  const projSel = h('select', { id: 'r-project' });
  const from = h('input', { type: 'date', id: 'r-from', value: state.from });
  const to = h('input', { type: 'date', id: 'r-to', value: state.to });
  const nb = checkbox('Ta med även icke-debiterbar tid', state.includeNonBillable, { id: 'r-nonbillable' });
  const out = h('div', { id: 'report-out' });

  const fillClients = () => clientSel.replaceChildren(option('', 'Välj kund …', !state.client), ...clients.map((c) => option(c, c, c === state.client)));
  const fillProjects = () => {
    const own = projects.filter((p) => p.client.trim() === state.client);
    if (!own.some((p) => p.id === state.projectId)) state.projectId = '';
    projSel.replaceChildren(option('', 'Alla projekt för kunden', !state.projectId), ...own.map((p) => option(p.id, p.name + (p.archived ? ' (arkiverat)' : ''), p.id === state.projectId)));
    projSel.disabled = !state.client;
  };
  const read = () => { state = { ...state, client: clientSel.value, projectId: projSel.value, from: from.value, to: to.value, includeNonBillable: nb.input.checked }; };

  const render = () => {
    if (!state.client) { out.replaceChildren(h('div', { class: 'card empty' }, h('p', null, 'Välj en kund och en period för att se underlaget.'))); return; }
    if (!state.from || !state.to || state.from > state.to) { out.replaceChildren(h('div', { class: 'card err', role: 'alert' }, 'Ange ett giltigt datumintervall där startdatum inte ligger efter slutdatum.')); return; }
    const rep = buildReport({ sessions, projects, ...state });
    out.replaceChildren(reportCard(rep, projects));
  };
  const onChange = (el, refill) => el.addEventListener('change', () => { read(); if (refill) { fillProjects(); read(); } render(); });
  onChange(clientSel, true); onChange(projSel); onChange(from); onChange(to); onChange(nb.input);

  const quick = (label, offset) => h('button', {
    type: 'button', class: 'btn quiet', 'data-quick': String(offset),
    onclick: () => { const r = monthRange(ctx.now(), offset); from.value = r.from; to.value = r.to; read(); render(); },
  }, label);

  fillClients(); fillProjects();
  root.replaceChildren(h('div', null,
    h('h1', { class: 'no-print' }, 'Kundunderlag'),
    h('div', { class: 'card no-print' },
      field('Kund', clientSel), field('Projekt', projSel),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, quick('Den här månaden', 0), quick('Förra månaden', -1)),
      h('div', { class: 'grid2' }, field('Från och med', from), field('Till och med', to)),
      nb.el,
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Start- och slutdatum ingår i perioden. Endast avslutade, sparade pass tas med.')),
    out));
  render();
}

function reportCard(rep, projects) {
  const p = projects.find((x) => x.id === rep.projectId);
  const periodText = `${rep.from} – ${rep.to}`;
  const errBox = h('div');
  const multi = !rep.projectId && rep.perProject.length > 1;
  const note = roundingDiffers(rep, (ms) => Math.round(ms / 60000));

  const rows = rep.rows.map((r) => h('tr', { class: r.billable ? '' : 'nonbill' },
    h('td', { style: 'white-space:nowrap' }, r.day),
    h('td', null, r.projectName),
    h('td', { class: 'desc' }, r.missing ? h('span', { class: 'missing-text' }, MISSING_TEXT) : r.description, r.billable ? null : h('div', { class: 'small' }, '(Ej debiterbar)')),
    h('td', { class: 'num' }, formatDuration(r.ms)),
    h('td', { class: 'num' }, decimalHours(r.ms))));

  const card = h('section', { class: 'card', id: 'report', 'aria-label': 'Kundunderlag' },
    h('h1', { class: 'print-only' }, 'Tidsunderlag'),
    h('h2', { style: 'margin-top:0' }, 'Tidsunderlag'),
    h('p', { style: 'margin:0' }, h('strong', null, 'Kund: '), rep.client),
    p ? h('p', { style: 'margin:0' }, h('strong', null, 'Projekt: '), p.name) : null,
    h('p', { style: 'margin:0 0 8px' }, h('strong', null, 'Period: '), periodText, ' (inklusive)'),
    h('div', { class: 'totals' },
      h('div', null, h('div', { class: 'muted small' }, 'Totalt'), h('div', { class: 'big', id: 'total-hm' }, formatDuration(rep.totalMs))),
      h('div', null, h('div', { class: 'muted small' }, 'Decimaltimmar'), h('div', { class: 'big', id: 'total-dec' }, `${decimalHours(rep.totalMs)} h`))),
    rep.includeNonBillable && rep.hasNonBillable ? h('p', { id: 'nonbill-note' }, `Varav icke-debiterbar tid: ${formatDuration(rep.nonBillableMs)} (${decimalHours(rep.nonBillableMs)} h). Raderna är markerade.`) : null,
    multi ? h('div', null, h('h2', null, 'Summa per projekt'), h('ul', { class: 'list', id: 'per-project' }, rep.perProject.map((x) => h('li', { style: 'display:flex;justify-content:space-between;gap:12px;padding:4px 0' }, h('span', null, x.name), h('span', null, `${formatDuration(x.ms)} (${decimalHours(x.ms)} h)`))))) : null,
    rep.rows.length === 0
      ? h('p', { class: 'muted', id: 'report-empty' }, 'Inga registrerade pass för valt urval och period.')
      : h('div', { class: 'table-wrap' }, h('table', { class: 'report' },
        h('thead', null, h('tr', null, h('th', null, 'Datum'), h('th', null, 'Projekt'), h('th', null, 'Arbetsbeskrivning'), h('th', { class: 'num' }, 'Tid'), h('th', { class: 'num' }, 'Timmar'))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td', { colspan: '3' }, 'Summa'), h('td', { class: 'num' }, formatDuration(rep.totalMs)), h('td', { class: 'num' }, decimalHours(rep.totalMs)))))),
    note ? h('p', { class: 'muted small' }, 'Summan beräknas på exakta tider och kan därför skilja någon minut från summan av de avrundade raderna.') : null,
    h('p', { class: 'muted small print-only' }, 'Tidsunderlag. Tid avrundas endast i presentationen. Kalenderdatum enligt svensk tid (Europe/Stockholm).'));

  const missing = rep.missingSessionIds.length
    ? h('div', { class: 'card warn no-print', id: 'missing-reminder' },
      h('strong', null, `${rep.missingSessionIds.length} ${rep.missingSessionIds.length === 1 ? 'pass saknar' : 'pass saknar'} arbetsbeskrivning i perioden. `),
      'Komplettera dem innan du skickar underlaget, annars visas texten ”Arbetsbeskrivning saknas”.',
      h('ul', { class: 'list', style: 'margin-top:8px' }, rep.missingSessionIds.map((id) => {
        const r = rep.rows.find((x) => x.sessionId === id);
        return h('li', null, h('a', { href: `#/pass/${id}`, class: 'btn', style: 'margin:4px 0' }, `Öppna pass ${r.day} – ${r.projectName}`));
      })))
    : null;

  const actions = h('div', { class: 'row no-print', style: 'margin:0 0 14px' },
    h('button', { type: 'button', class: 'btn primary', id: 'print-btn', disabled: rep.rows.length === 0, onclick: () => window.print() }, 'Skriv ut / spara som PDF'),
    h('button', {
      type: 'button', class: 'btn', id: 'csv-btn', disabled: rep.rows.length === 0,
      onclick: () => { try { download(`tidsunderlag-${slug(rep.client)}-${rep.from}_${rep.to}.csv`, toCsvBlob(rep)); } catch (e) { showError(errBox, e); } },
    }, 'Ladda ner CSV'));
  return h('div', null, errBox, missing, actions, card);
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kund';
