import { test, expect } from '@playwright/test';

test('manifest, scope och resurser fungerar under undermappen /konsulttimer/', async ({ page, request }) => {
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  expect(m.lang).toBe('sv');
  for (const icon of m.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await page.goto('./');
  // Inga anrop utanför appens egen sökväg (ingen extern trafik)
  const external = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!(u.origin === new URL(page.url()).origin && u.pathname.startsWith('/konsulttimer/'))) external.push(r.url()); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Timer' })).toBeVisible();
  expect(external).toEqual([]);
});

test('offline efter första laddningen: appen och data fungerar utan nät', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('konsulttimer-cache-')).length)).toBeGreaterThan(0);
  // Egen tjänstescope och cachenamn
  const info = await page.evaluate(async () => ({ scope: (await navigator.serviceWorker.getRegistration()).scope, caches: await caches.keys() }));
  expect(info.scope).toMatch(/\/konsulttimer\/$/);
  expect(info.caches.every((k) => k.startsWith('konsulttimer-cache-'))).toBe(true);
  // Ladda om en gång så att service workern styr sidan
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Timer' })).toBeVisible();
  await page.locator('.tabs').getByRole('link', { name: 'Projekt', exact: true }).click();
  await page.getByLabel('Projektnamn').fill('Offline');
  await page.getByLabel('Kundnamn').fill('Kund');
  await page.getByRole('button', { name: 'Skapa projekt' }).click();
  await expect(page.getByText('Offline').first()).toBeVisible();
  // Direkt navigering till djuplänk offline
  await page.goto('./#/historik');
  await expect(page.getByRole('heading', { name: 'Historik' })).toBeVisible();
  await context.setOffline(false);
});

test('appens lagring är skild från andra appar på samma webbplats', async ({ page }) => {
  await page.goto('./');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).toEqual(['konsulttimer-v1']);
});

test('bakgrundsläge: tiden räknas från tidsstämplar när appen återkommer', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('konsulttimer-v1');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['projects', 'sessions', 'meta'], 'readwrite');
      const now = Date.now();
      t.objectStore('projects').put({ id: 'p', name: 'Bakgrund', client: 'K', archived: false, createdAt: now, updatedAt: now, lastUsedAt: now });
      // Pass som startade för 3 h sedan – som om appen legat i bakgrunden
      t.objectStore('sessions').put({ id: 's', projectId: 'p', status: 'running', origin: 'timer', segments: [{ start: now - 3 * 3600000, end: null }], description: '', privateNotes: '', billable: true, corrected: false, measuredSegments: null, createdAt: now, updatedAt: now });
      t.objectStore('meta').put({ key: 'activeId', value: 's' });
      t.oncomplete = () => { db.close(); res(); };
    };
  }));
  await page.reload();
  await expect(page.locator('.clock')).toHaveText(/^03:00:0\d$/);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.clock')).toHaveText(/^03:00:\d\d$/);
  await expect(page.locator('#forgotten')).toHaveCount(0); // 3 h är inte "glömt"
});

test('glömt pass: föreslår granskning och stoppar inget automatiskt', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('konsulttimer-v1');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['projects', 'sessions', 'meta'], 'readwrite');
      const now = Date.now();
      t.objectStore('projects').put({ id: 'p', name: 'Glömt', client: 'K', archived: false, createdAt: now, updatedAt: now, lastUsedAt: now });
      t.objectStore('sessions').put({ id: 's', projectId: 'p', status: 'running', origin: 'timer', segments: [{ start: now - 30 * 3600000, end: null }], description: '', privateNotes: '', billable: true, corrected: false, measuredSegments: null, createdAt: now, updatedAt: now });
      t.objectStore('meta').put({ key: 'activeId', value: 's' });
      t.oncomplete = () => { db.close(); res(); };
    };
  }));
  await page.reload();
  await expect(page.locator('#forgotten')).toBeVisible();
  await expect(page.locator('.status')).toHaveText('Pågår'); // ej auto-stoppat
  await page.getByRole('button', { name: 'Granska och rätta passet' }).click();
  // Sluttid före start avvisas, giltig sluttid sparas
  await page.locator('#end-time').fill('00:00');
  await page.locator('#end-date').fill('2020-01-01');
  await page.locator('#review-save').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  const start = await page.evaluate(() => new Date(Date.now() - 30 * 3600000 + 2 * 3600000));
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(start));
  const g = (t) => iso.find((p) => p.type === t).value;
  await page.locator('#end-date').fill(`${g('year')}-${g('month')}-${g('day')}`);
  await page.locator('#end-time').fill(`${g('hour')}:${g('minute')}`);
  await page.locator('#review-save').click();
  await expect(page.getByRole('heading', { name: 'Arbetsanteckning' })).toBeVisible();
  await expect(page.locator('#note-duration')).toHaveText(/^(2 h 00|1 h 59) min$/);
});
