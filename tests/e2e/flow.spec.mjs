import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SECRET = 'PRIVAT-HEMLIGHET-42';
const stockholmDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const tab = (page, name) => page.locator('.tabs').getByRole('link', { name, exact: true });

async function createProject(page, name, client) {
  await tab(page, 'Projekt').click();
  await page.getByLabel('Projektnamn').fill(name);
  await page.getByLabel('Kundnamn').fill(client);
  await page.getByRole('button', { name: 'Skapa projekt' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

test('huvudflöde i mobilstorlek: projekt → timer → anteckning → historik → kundunderlag → export', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Timer' })).toBeVisible();
  await expect(page.getByText('Skapa ditt första projekt')).toBeVisible(); // tomt läge, inga påhittade data

  await createProject(page, 'Webbplats', 'Acme AB');
  await tab(page, 'Timer').click();

  // Inget projekt väljs automatiskt
  await expect(page.locator('#project-select')).toHaveValue('');
  await expect(page.locator('#start-btn')).toBeDisabled();
  await page.locator('#project-select').selectOption({ label: 'Webbplats – Acme AB' });
  await expect(page.locator('#client-line')).toHaveText('Kund: Acme AB');
  await page.locator('#start-btn').dblclick(); // dubbelklick ska bara ge ett pass

  const clock = page.locator('.clock');
  await expect(clock).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(clock).not.toHaveText('00:00:00');

  await page.locator('#pause-btn').click();
  await expect(page.locator('.status')).toHaveText('Pausad');
  const paused = await clock.textContent();
  await page.waitForTimeout(1300);
  expect(await clock.textContent()).toBe(paused); // pausen räknas inte

  // Omladdning bevarar tillståndet
  await page.reload();
  await expect(page.locator('.status')).toHaveText('Pausad');
  expect(await page.locator('.clock').textContent()).toBe(paused);

  await page.locator('#resume-btn').click();
  await expect(page.locator('.status')).toHaveText('Pågår');
  await page.waitForTimeout(1200);

  // Byte av projekt är inte tyst: kräver dialog
  await page.locator('#switch-project').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Avbryt' }).click();

  await page.locator('#stop-btn').dblclick();
  await expect(page.getByRole('heading', { name: 'Arbetsanteckning' })).toBeVisible();
  await expect(page.getByText('Tiden är sparad.')).toBeVisible();

  // Textutkast överlever omladdning
  await page.getByLabel('Vad arbetade du med?').fill('Byggde startsidan');
  await page.getByLabel('Privata anteckningar').fill(SECRET);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByLabel('Vad arbetade du med?')).toHaveValue('Byggde startsidan');
  await expect(page.getByLabel('Debiterbar tid')).toBeChecked();
  await page.getByRole('button', { name: 'Spara' }).click();

  // Historik: exakt ett pass
  await expect(page.getByRole('heading', { name: 'Historik' })).toBeVisible();
  await expect(page.locator('a.item')).toHaveCount(1);
  await expect(page.locator('a.item')).toContainText('Byggde startsidan');
  await expect(page.locator('a.item')).not.toContainText(SECRET);

  // Manuellt pass (2 h 15 min) utan beskrivning
  await page.getByRole('link', { name: 'Lägg till pass' }).click();
  await expect(page.getByRole('heading', { name: 'Lägg till tid manuellt' })).toBeVisible();
  await page.getByLabel('Projekt').selectOption({ label: 'Webbplats – Acme AB' });
  await page.getByLabel('Timmar').fill('2');
  await page.getByLabel('Minuter').fill('15');
  await page.getByLabel('Datum').fill(stockholmDay(-1)); // igår: oberoende av klockslag
  await page.getByLabel('Starttid').fill('08:00');
  await page.getByRole('button', { name: 'Spara' }).click();
  await expect(page.locator('a.item')).toHaveCount(2);
  await expect(page.locator('.badge.warn')).toBeVisible();
  await expect(page.getByText('Manuellt', { exact: true })).toBeVisible();

  // Ogiltig inmatning avvisas
  await page.getByRole('link', { name: 'Lägg till pass' }).click();
  await expect(page.getByRole('heading', { name: 'Lägg till tid manuellt' })).toBeVisible();
  await page.getByLabel('Projekt').selectOption({ label: 'Webbplats – Acme AB' });
  await page.getByLabel('Timmar').fill('0');
  await page.getByLabel('Minuter').fill('0');
  await page.getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByRole('alert')).toContainText('längre än 0');
  await page.getByLabel('Minuter').fill('-5');
  await page.getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByRole('alert')).toContainText('inte är negativa');
  await page.getByRole('link', { name: 'Avbryt' }).click();

  // Kundunderlag
  await tab(page, 'Underlag').click();
  await page.getByLabel('Kund', { exact: true }).selectOption('Acme AB');
  await expect(page.locator('#report')).toContainText('Kund: Acme AB');
  await expect(page.locator('#missing-reminder')).toContainText('saknar arbetsbeskrivning');
  await expect(page.locator('#report')).toContainText('Arbetsbeskrivning saknas');
  await expect(page.locator('#report')).not.toContainText(SECRET);
  await expect(page.locator('#total-hm')).toContainText('2 h');
  await page.locator('[data-quick="0"]').click();
  await page.locator('[data-quick="-1"]').click();
  await expect(page.getByLabel('Från och med')).toHaveValue(/^\d{4}-\d{2}-01$/);
  await page.getByLabel('Från och med').fill(stockholmDay(-1));
  await page.getByLabel('Till och med').fill(stockholmDay(0));
  await expect(page.locator('#report table tbody tr')).toHaveCount(2);

  // CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#csv-btn').click()]);
  expect(dl.suggestedFilename()).toMatch(/^tidsunderlag-acme-ab-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await dl.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Byggde startsidan');
  expect(csv).toContain('Arbetsbeskrivning saknas');
  expect(csv).not.toContain(SECRET);
  expect(csv).toMatch(/;2:15;2,25\r\n/);

  // Utskrift: ingen navigering, inga privata anteckningar
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.tabs')).toBeHidden();
  await expect(page.locator('#print-btn')).toBeHidden();
  await expect(page.locator('#report')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(SECRET);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.locator('#print-btn').click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
});

test('arkivering döljer projekt vid nytt pass men behåller historik', async ({ page }) => {
  await page.goto('./');
  await createProject(page, 'Gammalt', 'Kund X');
  await tab(page, 'Historik').click();
  await page.getByRole('link', { name: 'Lägg till pass' }).click();
  await expect(page.getByRole('heading', { name: 'Lägg till tid manuellt' })).toBeVisible();
  await page.getByLabel('Projekt').selectOption({ label: 'Gammalt – Kund X' });
  await page.getByLabel('Vad arbetade du med?').fill('Något');
  await page.getByRole('button', { name: 'Spara' }).click();
  await expect(page.locator('a.item')).toHaveCount(1);
  await tab(page, 'Projekt').click();
  await page.locator('[data-action="archive"]').click();
  await expect(page.getByRole('heading', { name: 'Arkiverade' })).toBeVisible();
  await tab(page, 'Timer').click();
  await expect(page.getByText('Skapa ditt första projekt')).toBeVisible();
  await tab(page, 'Historik').click();
  await expect(page.locator('a.item')).toHaveCount(1);
  await tab(page, 'Projekt').click();
  await page.locator('[data-action="restore"]').click();
  await expect(page.locator('[data-action="archive"]')).toBeVisible();
});

test('säkerhetskopia: export, ogiltig fil och återställning', async ({ page }, testInfo) => {
  await page.goto('./');
  await createProject(page, 'Backup-projekt', 'Backup AB');
  await tab(page, 'Inställningar').click();
  await expect(page.locator('#storage-info')).toContainText('lagras i den aktuella webbläsaren på den aktuella enheten');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-backup').click()]);
  const path = await dl.path();
  const backup = JSON.parse(readFileSync(path, 'utf8'));
  expect(backup.formatVersion).toBe(1);
  expect(backup.data.projects[0].name).toBe('Backup-projekt');

  // Ogiltig fil ändrar ingenting
  await page.locator('#restore-file').setInputFiles({ name: 'trasig.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"konsulttimer","formatVersion":1,"data":{"projects":[{"id":"x"}],"sessions":[]}}') });
  await expect(page.locator('#restore-invalid')).toBeVisible();
  await page.locator('#restore-file').setInputFiles({ name: 'skräp.json', mimeType: 'application/json', buffer: Buffer.from('inte json') });
  await expect(page.getByRole('alert')).toContainText('Inget har ändrats');

  // Ta bort data lokalt genom att återställa en annan giltig fil, sedan den ursprungliga
  const other = { ...backup, data: { ...backup.data, projects: [{ ...backup.data.projects[0], id: 'annat', name: 'Annat projekt' }] } };
  await page.locator('#restore-file').setInputFiles({ name: 'annan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
  await expect(page.locator('#restore-preview')).toContainText('1 projekt');
  await expect(page.locator('#restore-go')).toBeDisabled(); // kräver uttrycklig bekräftelse
  await page.getByLabel('Jag förstår').check();
  await page.locator('#restore-go').click();
  await expect(page.locator('#restore-done')).toBeVisible();
  await tab(page, 'Projekt').click();
  await expect(page.getByText('Annat projekt')).toBeVisible();
  await expect(page.getByText('Backup-projekt')).toHaveCount(0);
});

test('återställning avvisas medan timern är aktiv', async ({ page }) => {
  await page.goto('./');
  await createProject(page, 'P', 'K');
  await tab(page, 'Timer').click();
  await page.locator('#project-select').selectOption({ label: 'P – K' });
  await page.locator('#start-btn').click();
  await expect(page.locator('.clock')).toBeVisible();
  await tab(page, 'Inställningar').click();
  await expect(page.locator('#restore')).toContainText('Ett pass pågår');
});
