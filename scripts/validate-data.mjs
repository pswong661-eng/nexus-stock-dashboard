#!/usr/bin/env node
import fs from 'node:fs';
const path = new URL('../public/data/latest.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const required = ['generatedAt', 'symbols', 'summary'];
for (const key of required) if (!(key in data)) throw new Error(`Missing ${key}`);
if (!Array.isArray(data.symbols) || data.symbols.length === 0) throw new Error('symbols must be non-empty');
if (Number.isNaN(Date.parse(data.generatedAt))) throw new Error('generatedAt invalid');
for (const s of data.symbols) {
  if (!s.symbol || typeof s.symbol !== 'string') throw new Error('symbol missing');
  for (const field of ['price', 'rsi14', 'ytdPct']) {
    if (s[field] !== null && !Number.isFinite(s[field])) throw new Error(`${s.symbol}.${field} invalid`);
  }
  if (!Array.isArray(s.series) || s.series.length < 30) throw new Error(`${s.symbol}.series too short`);
}
console.log(`OK: ${data.symbols.length} symbols, generated ${data.generatedAt}, status ${data.dataStatus}`);
