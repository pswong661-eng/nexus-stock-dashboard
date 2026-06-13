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
  if (s.shortVolume) {
    if (!Array.isArray(s.shortVolume.history)) throw new Error(`${s.symbol}.shortVolume.history invalid`);
    for (const row of s.shortVolume.history) {
      if (!row.date || Number.isNaN(Date.parse(row.date))) throw new Error(`${s.symbol}.shortVolume.history.date invalid`);
      for (const field of ['totalVolume', 'shortVolume', 'shortVolumeRatio']) if (row[field] !== null && !Number.isFinite(row[field])) throw new Error(`${s.symbol}.shortVolume.${field} invalid`);
    }
  }
  if (s.unusualActivity) {
    if (!Array.isArray(s.unusualActivity.signals)) throw new Error(`${s.symbol}.unusualActivity.signals invalid`);
    for (const field of ['volumeMultiple', 'dayRangePct', 'gapPct', 'shortVolumeRatio']) if (s.unusualActivity[field] !== null && !Number.isFinite(s.unusualActivity[field])) throw new Error(`${s.symbol}.unusualActivity.${field} invalid`);
  }
}
console.log(`OK: ${data.symbols.length} symbols, generated ${data.generatedAt}, status ${data.dataStatus}`);
