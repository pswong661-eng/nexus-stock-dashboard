#!/usr/bin/env node
import fs from 'node:fs/promises';
import { buildFinancialsFromFacts, forecastTwo } from './sec-financials.mjs';
import { fetchYahooQuarterlies } from './yahoo-financials.mjs';

const OUT = new URL('../public/data/latest.json', import.meta.url);
const FALLBACK = new URL('../public/data/fallback.json', import.meta.url);
const SEC_UA = process.env.SEC_USER_AGENT || 'nexus-stock-dashboard/1.0 contact@example.com';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
const report = [];
for (const s of data.symbols) {
  if (!s.cik) {
    report.push({ symbol: s.symbol, error: 'no cik' });
    continue;
  }
  try {
    const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${s.cik}.json`);
    let financials = buildFinancialsFromFacts(facts.facts || {});
    if (financials.basis !== 'quarterly' || (financials.quarters || []).length < 4) {
      const yahoo = await fetchYahooQuarterlies(s.symbol).catch(() => null);
      if (yahoo?.quarters?.length) {
        yahoo.forecast = forecastTwo(yahoo.quarters);
        financials = yahoo;
      }
    }
    s.financials = financials;
    s.dataSources = { ...(s.dataSources || {}), financials: s.financials.source };
    report.push({
      symbol: s.symbol,
      basis: s.financials.basis,
      n: s.financials.quarters.length,
      periods: s.financials.quarters.map((q) => `${q.period}:${q.end}:${q.revenue ?? '—'}`)
    });
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    report.push({ symbol: s.symbol, error: String(err.message || err) });
  }
}
data.generatedAt = data.generatedAt; // keep price as-of
await fs.writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
await fs.writeFile(FALLBACK, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
