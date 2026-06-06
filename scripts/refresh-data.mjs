#!/usr/bin/env node
const SYMBOLS = (process.env.STOCK_SYMBOLS || 'VST,RGTI,IONQ,LAC,UAMY,SNPS,QCOM,RRX')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const OUT = new URL('../public/data/latest.json', import.meta.url);
const FALLBACK = new URL('../public/data/fallback.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finite(n) { return Number.isFinite(n) ? n : null; }
function round(n, d = 2) { return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }
function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null; }
function sma(arr) { const xs = arr.filter(Number.isFinite); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }

function rsi(closes, period = 14) {
  const xs = closes.filter(Number.isFinite);
  if (xs.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = xs.length - period; i < xs.length; i++) {
    const diff = xs[i] - xs[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function recommendation({ rsi14, ytdPct, price, week52Low, week52High }) {
  let score = 50;
  if (Number.isFinite(rsi14)) {
    if (rsi14 < 35) score += 18;
    else if (rsi14 < 45) score += 8;
    else if (rsi14 > 75) score -= 18;
    else if (rsi14 > 65) score -= 8;
  }
  if (Number.isFinite(ytdPct)) score += Math.max(-15, Math.min(15, ytdPct / 2));
  if ([price, week52Low, week52High].every(Number.isFinite) && week52High > week52Low) {
    const pos = (price - week52Low) / (week52High - week52Low);
    if (pos < 0.25) score += 12;
    if (pos > 0.85) score -= 10;
  }
  if (score >= 62) return 'BUY';
  if (score <= 38) return 'SELL';
  return 'HOLD';
}

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: { 'User-Agent': 'nexus-stock-dashboard/1.0' } });
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} empty chart result`);
  return result;
}

function normalize(symbol, result) {
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const closes = (quote.close || []).map(finite);
  const highs = (quote.high || []).map(finite).filter(Number.isFinite);
  const lows = (quote.low || []).map(finite).filter(Number.isFinite);
  const volumes = (quote.volume || []).map(finite).filter(Number.isFinite);
  const points = timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: round(closes[i], 4)
  })).filter(p => Number.isFinite(p.close));
  const firstTradingDay = points.find(p => p.date >= `${new Date().getUTCFullYear()}-01-01`) || points[0];
  const last = points.at(-1)?.close ?? finite(meta.regularMarketPrice);
  const ytdPct = pct(last, firstTradingDay?.close);
  const week52Low = lows.length ? Math.min(...lows) : finite(meta.fiftyTwoWeekLow);
  const week52High = highs.length ? Math.max(...highs) : finite(meta.fiftyTwoWeekHigh);
  const rsi14 = rsi(closes);
  const avgVolume = sma(volumes.slice(-30));
  const marketCap = finite(meta.marketCap);
  const peRatio = finite(meta.trailingPE);
  const rec = recommendation({ rsi14, ytdPct, price: last, week52Low, week52High });
  const normalized = points.length ? points.map(p => ({ date: p.date, value: round((p.close / points[0].close) * 100, 2) })) : [];
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    currency: meta.currency || 'USD',
    price: round(last, 2),
    previousClose: round(finite(meta.chartPreviousClose), 2),
    ytdPct: round(ytdPct, 2),
    marketCap: round(marketCap, 0),
    peRatio: round(peRatio, 2),
    rsi14: round(rsi14, 1),
    week52Low: round(week52Low, 2),
    week52High: round(week52High, 2),
    avgVolume: round(avgVolume, 0),
    recommendation: rec,
    opportunityScore: rec === 'BUY' ? 78 : rec === 'HOLD' ? 55 : 32,
    series: normalized,
    rawPoints: points.slice(-20)
  };
}

const results = [];
const errors = [];
for (const symbol of SYMBOLS) {
  try {
    const chart = await fetchChart(symbol);
    results.push(normalize(symbol, chart));
  } catch (err) {
    errors.push({ symbol, error: String(err.message || err) });
  }
  await sleep(300);
}

const bull = results.filter(s => s.recommendation === 'BUY').length;
const bear = results.filter(s => s.recommendation === 'SELL').length;
const neutral = Math.max(0, results.length - bull - bear);
const totalCap = results.reduce((sum, s) => sum + (Number.isFinite(s.marketCap) ? s.marketCap : 0), 0);
const avgPe = sma(results.map(s => s.peRatio));
const avgRsi = sma(results.map(s => s.rsi14));
const best = results.filter(s => Number.isFinite(s.ytdPct)).sort((a,b)=>b.ytdPct-a.ytdPct)[0] || null;
const worst = results.filter(s => Number.isFinite(s.ytdPct)).sort((a,b)=>a.ytdPct-b.ytdPct)[0] || null;
const sentimentScore = round((bull * 80 + neutral * 55 + bear * 25) / Math.max(1, results.length), 0);

const alerts = results.flatMap(s => {
  const arr = [];
  if (Number.isFinite(s.rsi14) && s.rsi14 > 70) arr.push({ symbol: s.symbol, severity: 'warning', message: `RSI overbought: ${s.rsi14} — momentum may be peaking` });
  if (Number.isFinite(s.rsi14) && s.rsi14 < 30) arr.push({ symbol: s.symbol, severity: 'info', message: `RSI oversold: ${s.rsi14} — possible bottom-fishing candidate` });
  if (Number.isFinite(s.ytdPct) && s.ytdPct > 25) arr.push({ symbol: s.symbol, severity: 'success', message: `Strong YTD performer: +${s.ytdPct}%` });
  if (Number.isFinite(s.ytdPct) && s.ytdPct < -15) arr.push({ symbol: s.symbol, severity: 'danger', message: `YTD drawdown: ${s.ytdPct}%` });
  return arr;
}).slice(0, 12).map((a, i) => ({ ...a, createdAt: new Date(Date.now() - i * 3600_000).toISOString() }));

const payload = {
  generatedAt: new Date().toISOString(),
  staleAfterMinutes: 45,
  source: 'Yahoo Finance chart endpoint via scheduled Node refresh',
  tickers: SYMBOLS,
  dataStatus: results.length ? (errors.length ? 'partial' : 'fresh') : 'fallback',
  marketStatus: new Date().getUTCDay() >= 1 && new Date().getUTCDay() <= 5 ? 'weekday' : 'closed_or_weekend',
  summary: {
    totalMarketCap: round(totalCap, 0),
    avgPeRatio: round(avgPe, 2),
    avgRsi14: round(avgRsi, 1),
    sentimentScore,
    bullPct: round((bull / Math.max(1, results.length)) * 100, 0),
    neutralPct: round((neutral / Math.max(1, results.length)) * 100, 0),
    bearPct: round((bear / Math.max(1, results.length)) * 100, 0),
    bestPerformer: best ? { symbol: best.symbol, ytdPct: best.ytdPct } : null,
    worstPerformer: worst ? { symbol: worst.symbol, ytdPct: worst.ytdPct } : null
  },
  symbols: results,
  alerts,
  errors
};

if (!results.length) {
  const old = await import('node:fs/promises').then(fs => fs.readFile(FALLBACK, 'utf8').catch(() => null));
  if (old) {
    const fallback = JSON.parse(old);
    fallback.generatedAt = new Date().toISOString();
    fallback.dataStatus = 'fallback';
    await import('node:fs/promises').then(fs => fs.writeFile(OUT, JSON.stringify(fallback, null, 2)));
    process.exit(0);
  }
  throw new Error('No symbols refreshed and no fallback data exists');
}

await import('node:fs/promises').then(fs => fs.writeFile(OUT, JSON.stringify(payload, null, 2)));
await import('node:fs/promises').then(fs => fs.writeFile(FALLBACK, JSON.stringify(payload, null, 2)));
console.log(`Refreshed ${results.length}/${SYMBOLS.length} symbols -> ${OUT.pathname}`);
if (errors.length) console.error(JSON.stringify(errors, null, 2));
