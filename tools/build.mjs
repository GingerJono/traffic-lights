// Builds the standalone site into dist/: node tools/build.mjs
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { wrapPage } from './page.mjs';

const src = new URL('../app/', import.meta.url);
const out = new URL('../dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(new URL('index.html', out), wrapPage(await readFile(new URL('index.html', src), 'utf8')));
for (const f of ['engine.js', 'app.js']) await copyFile(new URL(f, src), new URL(f, out));
await writeFile(new URL('.nojekyll', out), '');
console.log('Built dist/');
