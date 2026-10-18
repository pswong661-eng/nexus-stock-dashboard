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
  // Mission Control indicator set (merge 2026-10-18): present, finite-or-null.
  for (const field of ['sma50', 'sma200', 'ema50', 'macdDiff', 'support', 'resistance', 'pos52w', 'volRatio']) {
    if (!(field in s)) throw new Error(`${s.symbol}.local.${field} missing (schema v2)`);
    if (s[field] !== null && !Number.isFinite(s[field])) throw new Error(`${s.symbol}.${field} invalid`);
  }
  for (const field of ['bias', 'signal', 'macdStatus']) {
    if (!(field in s) || typeof s[field] !== 'string' || !s[field]) throw new Error(`${s.symbol}.${field} missing (schema v2)`);
  }
  if (!Number.isInteger(s.score) || s.score < 0 || s.score > 4) throw new Error(`${s.symbol}.score invalid (schema v2, 0-4)`);
  // Privacy invariant (Eric 2026-10-18): trade-plan levels never ship publicly.
  for (const banned of ['entryLow', 'entryHigh', 'targetLow', 'targetHigh', 'stopLoss', 'entry_low', 'entry_high', 'target_low', 'target_high', 'stop_loss']) {
    if (banned in s) throw new Error(`${s.symbol}.${banned} must not appear in public data`);
  }
  if (!Array.isArray(s.series) || s.series.length < 30) throw new Error(`${s.symbol}.series too short`);
  if (!Array.isArray(s.technical) || s.technical.length < 30) throw new Error(`${s.symbol}.technical too short`);
  const last = s.technical.at(-1);
  for (const field of ['ema50','rsi14','macd','macdSignal']) if (last[field] !== null && !Number.isFinite(last[field])) throw new Error(`${s.symbol}.technical.${field} invalid`);
  if (!s.financials || !Array.isArray(s.financials.quarters) || !Array.isArray(s.financials.forecast)) throw new Error(`${s.symbol}.financials missing`);
  const seenPeriods = new Set();
  for (const q of s.financials.quarters) {
    const key = `${q.period || ''}-${q.end || ''}`;
    if (seenPeriods.has(key)) throw new Error(`${s.symbol}.financials duplicate period ${key}`);
    seenPeriods.add(key);
  }
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
