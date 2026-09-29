// Renderar PNG-ikoner från SVG med Playwrights Chromium. Körs manuellt vid ändrad logotyp: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const jobs = [
  ['src/icons/icon.svg', 'src/icons/icon-192.png', 192],
  ['src/icons/icon.svg', 'src/icons/icon-512.png', 512],
  ['src/icons/icon-maskable.svg', 'src/icons/apple-touch-icon.png', 180],
  ['src/icons/icon-maskable.svg', 'src/icons/icon-maskable-512.png', 512],
];
const browser = await chromium.launch();
for (const [svg, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const b64 = readFileSync(svg).toString('base64');
  await page.setContent(`<body style="margin:0"><img src="data:image/svg+xml;base64,${b64}" width="${size}" height="${size}"></body>`);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
}
await browser.close();
