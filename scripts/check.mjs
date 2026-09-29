// Statiska kontroller: syntax, inga externa resurser, att bygget är konsekvent för GitHub Pages under undermapp.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const problems = [];
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

for (const f of walk('src').filter((f) => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems.push(`Syntaxfel i ${f}: ${e.stderr}`); }
}
for (const f of [...walk('src').filter((f) => /\.(js|html|css|webmanifest)$/.test(f))]) {
  const t = readFileSync(f, 'utf8');
  if (/(src|href)="\/[^/]/.test(t) || /(src|href)=["']https?:/.test(t)) problems.push(`${f}: rotrelativ eller extern länk (bryter på GitHub Pages undermapp / får ej finnas)`);
  if (/\bfetch\(\s*['"`]https?:/.test(t) || /XMLHttpRequest|sendBeacon|gtag|analytics/.test(t)) problems.push(`${f}: möjlig extern överföring`);
  if (/innerHTML\s*=/.test(t)) problems.push(`${f}: innerHTML används (använd textnoder)`);
}
const manifest = JSON.parse(readFileSync('src/manifest.webmanifest', 'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './') problems.push('Manifest måste ha relativ start_url och scope ("./")');
for (const i of manifest.icons) if (!existsSync(join('src', i.src))) problems.push(`Manifestikon saknas: ${i.src}`);
const sw = readFileSync('src/sw.js', 'utf8');
if (!sw.includes("CACHE_PREFIX = 'konsulttimer-cache-'")) problems.push('sw.js måste använda eget cache-prefix');

if (existsSync('dist/sw.js')) {
  const built = readFileSync('dist/sw.js', 'utf8');
  if (built.includes('__VERSION__') || built.includes('__PRECACHE_JSON__')) problems.push('dist/sw.js har ostämplade platshållare');
  const list = JSON.parse(built.match(/JSON\.parse\('(.*)'\)/)[1]);
  for (const f of list) if (f !== './' && !existsSync(join('dist', f))) problems.push(`Precache pekar på saknad fil: ${f}`);
  if (!existsSync('dist/.nojekyll')) problems.push('dist/.nojekyll saknas');
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Kontroller OK');
