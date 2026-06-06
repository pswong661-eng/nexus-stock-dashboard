#!/usr/bin/env node
import fs from 'node:fs';
const path = new URL('../public/data/latest.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const key of ['generatedAt', 'symbols', 'summary']) if (!(key in data)) throw new Error(`Missing ${key}`);
if (!Array.isArray(data.symbols) || data.symbols.length === 0) throw new Error('symbols must be non-empty');
if (Number.isNaN(Date.parse(data.generatedAt))) throw new Error('generatedAt invalid');
for (const s of data.symbols) {
  if (!s.symbol || typeof s.symbol !== 'string') throw new Error('symbol missing');
  for (const field of ['price', 'rsi14', 'ytdPct']) if (s[field] !== null && !Number.isFinite(s[field])) throw new Error(`${s.symbol}.${field} invalid`);
  if (!Array.isArray(s.series) || s.series.length < 30) throw new Error(`${s.symbol}.series too short`);
  if (!Array.isArray(s.technical) || s.technical.length < 30) throw new Error(`${s.symbol}.technical too short`);
  const last = s.technical.at(-1);
  for (const field of ['ema50','rsi14','macd','macdSignal']) if (last[field] !== null && !Number.isFinite(last[field])) throw new Error(`${s.symbol}.technical.${field} invalid`);
  if (!s.financials || !Array.isArray(s.financials.quarters) || !Array.isArray(s.financials.forecast)) throw new Error(`${s.symbol}.financials missing`);
  if (!Array.isArray(s.insider)) throw new Error(`${s.symbol}.insider missing`);
  if (!s.insiderSummary || typeof s.insiderSummary.sentiment !== 'string') throw new Error(`${s.symbol}.insiderSummary missing`);
}
console.log(`OK: ${data.symbols.length} symbols, generated ${data.generatedAt}, status ${data.dataStatus}`);
