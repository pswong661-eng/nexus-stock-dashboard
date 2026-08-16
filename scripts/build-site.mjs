#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(new URL('./public/data/', dist), { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'CNAME', 'favicon.ico', 'favicon.svg', 'robots.txt']) {
  try {
    await fs.copyFile(new URL(file, root), new URL(file, dist));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
await fs.cp(new URL('../public/', import.meta.url), new URL('./public/', dist), { recursive: true });
console.log(`Built static site -> ${dist.pathname}`);
