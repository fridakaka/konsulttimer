import { openStore } from './db.js';
import { h } from './ui/dom.js';
import { timerView } from './ui/timerView.js';
import { noteView } from './ui/noteView.js';
import { sessionFormView } from './ui/sessionForm.js';
import { historyView } from './ui/historyView.js';
import { projectsView } from './ui/projectsView.js';
import { reportView } from './ui/reportView.js';
import { settingsView } from './ui/settingsView.js';

const routes = [
  { pattern: /^$/, view: timerView, nav: 'timer', live: true },
  { pattern: /^historik$/, view: historyView, nav: 'historik', live: true },
  { pattern: /^projekt$/, view: projectsView, nav: 'projekt', live: true },
  { pattern: /^underlag$/, view: reportView, nav: 'underlag' },
  { pattern: /^installningar$/, view: settingsView, nav: 'installningar' },
  { pattern: /^anteckning\/([^/]+)$/, view: noteView, nav: 'timer' },
  { pattern: /^pass\/([^/]+)$/, view: sessionFormView, nav: 'historik' },
  { pattern: /^nytt-pass$/, view: sessionFormView, nav: 'historik' },
];

const root = document.getElementById('main');
let store;
let ticker = null;
let token = 0;
let current = null;

const ctx = {
  get store() { return store; },
  now: () => Date.now(),
  navigate(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  rerender: () => render(),
  setTicker(fn, ms) { clearTicker(); ticker = setInterval(fn, ms); },
};

function clearTicker() { if (ticker) clearInterval(ticker); ticker = null; }

async function render() {
  const my = ++token;
  clearTicker();
  const path = location.hash.replace(/^#\/?/, '');
  const route = routes.find((r) => r.pattern.test(path)) ?? routes[0];
  const params = (path.match(route.pattern) ?? []).slice(1).map(decodeURIComponent);
  current = route;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.route === route.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const holder = h('div');
  try {
    await route.view(ctx, holder, params);
    if (my !== token) return; // en nyare visning har tagit över
    root.replaceChildren(...holder.childNodes);
    if (params.length || path) root.focus({ preventScroll: true });
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    root.replaceChildren(h('div', { class: 'card err', role: 'alert' }, 'Något gick fel när sidan skulle visas. Ladda om appen. Dina sparade uppgifter påverkas inte.'));
  }
}

async function init() {
  try {
    store = await openStore();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'card err', role: 'alert', style: 'margin:16px' }, e.message || 'Den lokala lagringen kunde inte öppnas.'));
    return;
  }
  store.onChange(() => { if (current?.live && !document.querySelector('dialog[open]')) render(); });
  window.addEventListener('hashchange', render);
  // Återkomst från bakgrund/skärmlås: räkna om från sparade tidsstämplar.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current?.live) render(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && current?.live) render(); });
  navigator.storage?.persist?.().catch(() => {});
  await render();
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker kunde inte registreras', e));
}

init();
