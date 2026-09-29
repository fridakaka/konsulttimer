import { h, showError, guarded, toast, download, checkbox } from './dom.js';
import { makeBackup, validateBackup } from '../backup.js';
import { APP_VERSION } from '../config.js';
import { dayKey } from '../time.js';

export async function settingsView(ctx, root) {
  const errBox = h('div');
  const preview = h('div');
  const active = await ctx.store.getActive();
  let persisted = 'okänt';
  try { if (navigator.storage?.persisted) persisted = (await navigator.storage.persisted()) ? 'ja' : 'nej'; } catch { /* ignoreras */ }

  const exportBackup = guarded(async () => {
    try {
      const data = await ctx.store.exportAll();
      const json = JSON.stringify(makeBackup(data, ctx.now()), null, 2);
      download(`konsulttimer-sakerhetskopia-${dayKey(ctx.now())}.json`, new Blob([json], { type: 'application/json' }));
      toast('Säkerhetskopian laddades ned.');
    } catch (e) { showError(errBox, e); }
  });

  const fileInput = h('input', { type: 'file', id: 'restore-file', accept: 'application/json,.json' });
  fileInput.addEventListener('change', async () => {
    preview.replaceChildren();
    errBox.replaceChildren();
    const file = fileInput.files?.[0];
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch {
      return showError(errBox, { name: 'AppError', message: 'Filen kunde inte läsas som JSON. Inget har ändrats.' });
    }
    const v = validateBackup(parsed);
    if (!v.ok) {
      preview.replaceChildren(h('div', { class: 'card err', role: 'alert', id: 'restore-invalid' }, h('strong', null, 'Filen kan inte återställas. Inget har ändrats.'), h('ul', null, v.errors.map((e) => h('li', null, e)))));
      return;
    }
    const s = v.summary;
    const confirm = checkbox('Jag förstår att alla nuvarande uppgifter ersätts av filens innehåll.', false, { id: 'restore-confirm' });
    const go = h('button', { type: 'button', class: 'btn danger', id: 'restore-go', disabled: true }, 'Ersätt mina uppgifter');
    confirm.input.addEventListener('change', () => { go.disabled = !confirm.input.checked || !!active; });
    go.addEventListener('click', guarded(async () => {
      try {
        await ctx.store.replaceAll(v.data);
        toast('Säkerhetskopian är återställd.');
        fileInput.value = '';
        preview.replaceChildren(h('div', { class: 'card', id: 'restore-done' }, 'Återställningen är klar.'));
      } catch (e) { showError(errBox, e); }
    }));
    preview.replaceChildren(h('div', { class: 'card', id: 'restore-preview' },
      h('h3', { style: 'margin-top:0' }, 'Filen innehåller'),
      h('ul', null,
        h('li', null, `${s.projects} projekt (varav ${s.archivedProjects} arkiverade)`),
        h('li', null, `${s.sessions} pass`),
        s.firstStart ? h('li', null, `Pass från ${dayKey(s.firstStart)} till ${dayKey(s.lastStart)}`) : null,
        s.exportedAt ? h('li', null, `Exporterad ${s.exportedAt.slice(0, 16).replace('T', ' ')} (UTC)`) : null,
        s.hasUnfinished ? h('li', null, 'Innehåller ett pågående pass') : null),
      active ? h('p', { class: 'muted' }, 'Ett pass pågår just nu. Stoppa timern innan du återställer.') : null,
      h('p', null, h('strong', null, 'Återställningen ersätter allt som finns i appen nu.'), ' Exportera gärna nuvarande data först.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', id: 'export-before', onclick: exportBackup }, 'Exportera nuvarande data först')),
      confirm.el, go));
  });

  root.replaceChildren(h('div', null,
    h('h1', null, 'Inställningar'),
    errBox,
    h('section', { class: 'card', id: 'storage-info' },
      h('h2', { style: 'margin-top:0' }, 'Var lagras dina uppgifter?'),
      h('p', null, h('strong', null, 'Uppgifterna lagras i den aktuella webbläsaren på den aktuella enheten.'), ' Det finns inget konto, ingen server och ingen synkning mellan enheter. Om du byter telefon eller dator, eller rensar webbläsarens data, försvinner uppgifterna om du inte har en säkerhetskopia.'),
      h('p', null, 'GitHub innehåller appens kod, inte dina registrerade tider. Inget skickas till någon annan.'),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, `Beständig lagring beviljad: ${persisted}. Version ${APP_VERSION}.`)),
    h('section', { class: 'card', id: 'backup' },
      h('h2', { style: 'margin-top:0' }, 'Säkerhetskopia'),
      h('p', null, h('strong', null, 'Säkerhetskopian innehåller allt, även dina privata anteckningar.'), ' Förvara filen säkert och skicka den inte till kunder. Kundunderlaget (utskrift och CSV) skapar du på sidan Underlag och innehåller aldrig privata anteckningar.'),
      h('button', { type: 'button', class: 'btn primary', id: 'export-backup', onclick: exportBackup }, 'Exportera säkerhetskopia')),
    h('section', { class: 'card', id: 'restore' },
      h('h2', { style: 'margin-top:0' }, 'Återställ säkerhetskopia'),
      h('p', null, 'Återställning ersätter alla uppgifter i appen med filens innehåll. Filen kontrolleras helt innan något ändras.'),
      active ? h('p', { class: 'card warn', role: 'alert' }, 'Ett pass pågår. Stoppa timern innan du återställer.') : null,
      h('label', { for: 'restore-file' }, 'Välj säkerhetskopia (.json)'),
      fileInput, preview)));
}
