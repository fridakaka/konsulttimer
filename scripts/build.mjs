// Bygger dist/ av src/: kopierar filer, stämplar versionen (innehållshash) och skriver precache-listan till sw.js.
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const src = 'src';
const dist = 'dist';
rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(dist).map((p) => relative(dist, p).split(sep).join('/')).filter((f) => f !== 'sw.js').sort();

const hash = createHash('sha256');
for (const f of [...files, 'sw.js']) { hash.update(f); hash.update(readFileSync(join(dist, f))); }
const version = hash.digest('hex').slice(0, 10);

const precache = ['./', ...files];
const stamp = (file, map) => {
  let text = readFileSync(join(dist, file), 'utf8');
  for (const [k, v] of Object.entries(map)) text = text.split(k).join(v);
  writeFileSync(join(dist, file), text);
};
stamp('sw.js', { __VERSION__: version, __PRECACHE_JSON__: JSON.stringify(precache) });
stamp('js/config.js', { __VERSION__: version });
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`Byggde dist/ (version ${version}, ${precache.length} filer i precache)`);
