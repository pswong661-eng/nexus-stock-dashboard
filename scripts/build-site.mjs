#!/usr/bin/env node
import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(new URL('./public/data/', dist), { recursive: true });
for (const file of ['index.html', '404.html', 'style.css', 'app.js', 'chart.umd.min.js', 'CNAME', 'favicon.ico', 'favicon.svg', 'robots.txt']) {
  try {
    await fs.copyFile(new URL(file, root), new URL(file, dist));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
await fs.cp(new URL('../public/', import.meta.url), new URL('./public/', dist), { recursive: true });

// Cache-bust asset URLs with the git SHA so browsers pick up every deploy.
let sha = 'nogit';
try { sha = execSync('git rev-parse --short HEAD', { cwd: new URL('.', import.meta.url).pathname }).toString().trim(); } catch { /* fine */ }
const idxPath = new URL('./index.html', dist);
const idx = (await fs.readFile(idxPath, 'utf8')).replace(/\?v=[^"']+/g, `?v=${sha}`);
await fs.writeFile(idxPath, idx);
console.log(`Built static site -> ${dist.pathname} (assets @ ${sha})`);
