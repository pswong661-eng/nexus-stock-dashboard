#!/usr/bin/env node
const SYMBOLS = (process.env.STOCK_SYMBOLS || 'VST,RGTI,IONQ,LAC,UAMY,SNPS,QCOM,RRX')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const OUT = new URL('../public/data/latest.json', import.meta.url);
const FALLBACK = new URL('../public/data/fallback.json', import.meta.url);
const SEC_UA = process.env.SEC_USER_AGENT || 'nexus-stock-dashboard/1.0 contact@example.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finite(n) { return Number.isFinite(n) ? n : null; }
function round(n, d = 2) { return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }
function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null; }
function sma(arr) { const xs = arr.filter(Number.isFinite); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
function ema(values, period) {
  const out = []; const k = 2 / (period + 1); let prev = null;
  for (const v of values) {
    if (!Number.isFinite(v)) { out.push(null); continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out.push(round(prev, 4));
  }
  return out;
}
function rsiSeries(values, period = 14) {
  const out = Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - values[j - 1];
      if (!Number.isFinite(diff)) continue;
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period, avgLoss = losses / period;
    out[i] = round(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)), 2);
  }
  return out;
}
function macd(values) {
  const e12 = ema(values, 12), e26 = ema(values, 26);
  const line = values.map((_, i) => Number.isFinite(e12[i]) && Number.isFinite(e26[i]) ? round(e12[i] - e26[i], 4) : null);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => Number.isFinite(v) && Number.isFinite(signal[i]) ? round(v - signal[i], 4) : null);
  return { line, signal, hist };
}
function recommendation({ rsi14, ytdPct, price, week52Low, week52High }) {
  let score = 50;
  if (Number.isFinite(rsi14)) {
    if (rsi14 < 35) score += 18; else if (rsi14 < 45) score += 8;
    else if (rsi14 > 75) score -= 18; else if (rsi14 > 65) score -= 8;
  }
  if (Number.isFinite(ytdPct)) score += Math.max(-15, Math.min(15, ytdPct / 2));
  if ([price, week52Low, week52High].every(Number.isFinite) && week52High > week52Low) {
    const pos = (price - week52Low) / (week52High - week52Low);
    if (pos < 0.25) score += 12; if (pos > 0.85) score -= 10;
  }
  return score >= 62 ? 'BUY' : score <= 38 ? 'SELL' : 'HOLD';
}
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': SEC_UA, ...headers } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}
async function fetchChart(symbol) {
  return (await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false&events=div%2Csplits`)).chart?.result?.[0];
}
function normalizeChart(symbol, result) {
  const meta = result.meta || {}, quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const closes = (quote.close || []).map(finite);
  const highs = (quote.high || []).map(finite).filter(Number.isFinite);
  const lows = (quote.low || []).map(finite).filter(Number.isFinite);
  const volumes = (quote.volume || []).map(finite).filter(Number.isFinite);
  const points = timestamps.map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: round(closes[i], 4) })).filter(p => Number.isFinite(p.close));
  const closeValues = points.map(p => p.close);
  const firstTradingDay = points.find(p => p.date >= `${new Date().getUTCFullYear()}-01-01`) || points[0];
  const last = points.at(-1)?.close ?? finite(meta.regularMarketPrice);
  const ytdPct = pct(last, firstTradingDay?.close);
  const week52Low = lows.length ? Math.min(...lows) : finite(meta.fiftyTwoWeekLow);
  const week52High = highs.length ? Math.max(...highs) : finite(meta.fiftyTwoWeekHigh);
  const rsiArr = rsiSeries(closeValues, 14);
  const ema50Arr = ema(closeValues, 50);
  const macdObj = macd(closeValues);
  const rsi14 = rsiArr.at(-1);
  const avgVolume = sma(volumes.slice(-30));
  const rec = recommendation({ rsi14, ytdPct, price: last, week52Low, week52High });
  const normalized = points.map(p => ({ date: p.date, value: round((p.close / points[0].close) * 100, 2) }));
  const technical = points.map((p, i) => ({
    date: p.date,
    close: p.close,
    ema50: ema50Arr[i],
    rsi14: rsiArr[i],
    macd: macdObj.line[i],
    macdSignal: macdObj.signal[i],
    macdHist: macdObj.hist[i]
  })).slice(-160);
  return {
    symbol, name: meta.longName || meta.shortName || symbol, exchange: meta.fullExchangeName || meta.exchangeName || '', currency: meta.currency || 'USD',
    price: round(last, 2), previousClose: round(finite(meta.chartPreviousClose), 2), ytdPct: round(ytdPct, 2),
    marketCap: null, peRatio: null, rsi14: round(rsi14, 1), week52Low: round(week52Low, 2), week52High: round(week52High, 2), avgVolume: round(avgVolume, 0),
    recommendation: rec, opportunityScore: rec === 'BUY' ? 78 : rec === 'HOLD' ? 55 : 32,
    series: normalized, technical, rawPoints: points.slice(-20)
  };
}
async function cikMap() {
  const raw = await fetchJson('https://www.sec.gov/files/company_tickers.json');
  const map = {};
  for (const row of Object.values(raw)) map[row.ticker.toUpperCase()] = String(row.cik_str).padStart(10, '0');
  return map;
}
function pickFact(facts, names) {
  for (const name of names) {
    const usd = facts?.['us-gaap']?.[name]?.units?.USD;
    if (Array.isArray(usd)) return usd;
  }
  return [];
}
function lastQuarters(items) {
  const seen = new Map();
  for (const f of items) {
    if (!Number.isFinite(f.val) || !f.end) continue;
    if (!['10-Q','10-K'].includes(f.form)) continue;
    const key = f.frame || `${f.fy || ''}-${f.fp || ''}-${f.end}`;
    const prev = seen.get(key);
    if (!prev || (f.filed || '') > (prev.filed || '')) seen.set(key, f);
  }
  return [...seen.values()].sort((a,b)=>new Date(a.end)-new Date(b.end)).slice(-6).map(f => ({
    period: f.fp && f.fy ? `${f.fy} ${f.fp}` : f.end,
    end: f.end,
    value: round(f.val, 0),
    form: f.form,
    filed: f.filed || null
  }));
}
function forecastTwo(quarters) {
  if (!quarters.length) return [];
  const vals = quarters.map(q => q.value).filter(Number.isFinite);
  const last = vals.at(-1); const prev = vals.at(-2) ?? last;
  const growth = last && prev ? Math.max(-0.25, Math.min(0.25, (last - prev) / Math.abs(prev))) : 0;
  return [1,2].map(i => ({ period: `Forecast Q+${i}`, value: round(last * Math.pow(1 + growth, i), 0), basis: 'simple trend forecast' }));
}
async function fetchFinancialAndInsider(symbol, cik) {
  if (!cik) return { financials: { quarters: [], forecast: [] }, insider: [] };
  const [facts, sub] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`).catch(() => null),
    fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`).catch(() => null)
  ]);
  const revenues = lastQuarters(pickFact(facts?.facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']));
  const netIncome = lastQuarters(pickFact(facts?.facts, ['NetIncomeLoss']));
  const quarters = revenues.map((r, i) => ({ ...r, revenue: r.value, netIncome: netIncome.find(n => n.end === r.end)?.value ?? null }));
  const recent = sub?.filings?.recent || {};
  const insider = (recent.form || []).map((form, i) => ({ form, reportDate: recent.reportDate?.[i], filingDate: recent.filingDate?.[i], accessionNumber: recent.accessionNumber?.[i], document: recent.primaryDocument?.[i], description: recent.primaryDocDescription?.[i] }))
    .filter(f => f.form === '4')
    .slice(0, 8)
    .map(f => ({ ...f, url: f.accessionNumber && f.document ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accessionNumber.replaceAll('-', '')}/${f.document}` : null }));
  return { financials: { quarters, forecast: forecastTwo(quarters.map(q => ({...q, value: q.revenue}))) }, insider };
}

const results = [], errors = [];
let ciks = {};
try { ciks = await cikMap(); } catch (e) { errors.push({ symbol: 'SEC', error: String(e.message || e) }); }
for (const symbol of SYMBOLS) {
  try {
    const chart = await fetchChart(symbol);
    if (!chart) throw new Error('empty chart result');
    const base = normalizeChart(symbol, chart);
    const extra = await fetchFinancialAndInsider(symbol, ciks[symbol]);
    results.push({ ...base, cik: ciks[symbol] || null, ...extra });
  } catch (err) { errors.push({ symbol, error: String(err.message || err) }); }
  await sleep(350);
}
const bull = results.filter(s => s.recommendation === 'BUY').length;
const bear = results.filter(s => s.recommendation === 'SELL').length;
const neutral = Math.max(0, results.length - bull - bear);
const avgRsi = sma(results.map(s => s.rsi14));
const best = results.filter(s => Number.isFinite(s.ytdPct)).sort((a,b)=>b.ytdPct-a.ytdPct)[0] || null;
const worst = results.filter(s => Number.isFinite(s.ytdPct)).sort((a,b)=>a.ytdPct-b.ytdPct)[0] || null;
const sentimentScore = round((bull * 80 + neutral * 55 + bear * 25) / Math.max(1, results.length), 0);
const alerts = results.flatMap(s => {
  const arr = [];
  const lastTech = s.technical?.at(-1) || {};
  if (Number.isFinite(s.rsi14) && s.rsi14 > 70) arr.push({ symbol: s.symbol, severity: 'warning', message: `RSI overbought: ${s.rsi14}` });
  if (Number.isFinite(s.rsi14) && s.rsi14 < 30) arr.push({ symbol: s.symbol, severity: 'info', message: `RSI oversold: ${s.rsi14}` });
  if (Number.isFinite(lastTech.macd) && Number.isFinite(lastTech.macdSignal) && lastTech.macd > lastTech.macdSignal) arr.push({ symbol: s.symbol, severity: 'success', message: `MACD above signal line` });
  if (Number.isFinite(s.ytdPct) && s.ytdPct > 25) arr.push({ symbol: s.symbol, severity: 'success', message: `Strong YTD performer: +${s.ytdPct}%` });
  return arr;
}).slice(0, 14).map((a, i) => ({ ...a, createdAt: new Date(Date.now() - i * 3600_000).toISOString() }));
const payload = {
  generatedAt: new Date().toISOString(), staleAfterMinutes: 1440,
  source: 'Yahoo Finance chart endpoint + SEC companyfacts/submissions via scheduled Node refresh',
  tickers: SYMBOLS, dataStatus: results.length ? (errors.length ? 'partial' : 'fresh') : 'fallback',
  marketStatus: new Date().getUTCDay() >= 1 && new Date().getUTCDay() <= 5 ? 'weekday' : 'closed_or_weekend',
  summary: { totalMarketCap: null, avgPeRatio: null, avgRsi14: round(avgRsi, 1), sentimentScore, bullPct: round((bull / Math.max(1, results.length)) * 100, 0), neutralPct: round((neutral / Math.max(1, results.length)) * 100, 0), bearPct: round((bear / Math.max(1, results.length)) * 100, 0), bestPerformer: best ? { symbol: best.symbol, ytdPct: best.ytdPct } : null, worstPerformer: worst ? { symbol: worst.symbol, ytdPct: worst.ytdPct } : null },
  symbols: results, alerts, errors
};
if (!results.length) {
  const old = await import('node:fs/promises').then(fs => fs.readFile(FALLBACK, 'utf8').catch(() => null));
  if (old) { const fallback = JSON.parse(old); fallback.generatedAt = new Date().toISOString(); fallback.dataStatus = 'fallback'; await import('node:fs/promises').then(fs => fs.writeFile(OUT, JSON.stringify(fallback, null, 2))); process.exit(0); }
  throw new Error('No symbols refreshed and no fallback data exists');
}
await import('node:fs/promises').then(fs => fs.writeFile(OUT, JSON.stringify(payload, null, 2)));
await import('node:fs/promises').then(fs => fs.writeFile(FALLBACK, JSON.stringify(payload, null, 2)));
console.log(`Refreshed ${results.length}/${SYMBOLS.length} symbols -> ${OUT.pathname}`);
if (errors.length) console.error(JSON.stringify(errors, null, 2));
