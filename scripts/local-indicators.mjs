// local-indicators.mjs — ports the Mission Control indicator set
// (daily_stock_watchlist.py::compute_metrics) so the public dashboard carries
// the same numbers as 127.0.0.1:8888/stocks.
//
// Contract: input `points` = [{date, open, high, low, close, volume}, ...]
// ordered oldest → newest. Output = the local dashboard fields, minus
// entry/target/stop (excluded from the public schema by Eric's decision
// 2026-10-18 — trade-plan levels stay internal only).

const finite = n => Number.isFinite(n) ? n : null;
const round = (n, d = 2) => Number.isFinite(n) ? Number(n.toFixed(d)) : null;

function smaLast(values, period) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < period) return null;
  const win = xs.slice(-period);
  return win.reduce((a, b) => a + b, 0) / period;
}

// pandas ewm(span=N, adjust=False): recursive, seeded with the first value.
function emaLast(values, span) {
  const k = 2 / (span + 1);
  let prev = null;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
  }
  return prev;
}
function emaSeries(values, span) {
  const out = [];
  const k = 2 / (span + 1);
  let prev = null;
  for (const v of values) {
    if (!Number.isFinite(v)) { out.push(null); continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// Simple-rolling RSI(14) — matches the local pipeline (not Wilder smoothing).
function rsiLast(values, period = 14) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = xs.length - period; i < xs.length; i++) {
    const diff = xs[i] - xs[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function macdCross(values) {
  const e12 = emaSeries(values, 12), e26 = emaSeries(values, 26);
  const line = values.map((_, i) => Number.isFinite(e12[i]) && Number.isFinite(e26[i]) ? e12[i] - e26[i] : null);
  const signal = emaSeries(line, 9);
  const diff = line.map((v, i) => Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : null);
  const finiteDiff = diff.filter(Number.isFinite);
  const macdDiff = finiteDiff.length ? round(finiteDiff[finiteDiff.length - 1], 4) : null;
  let status = 'n/a';
  if (finiteDiff.length >= 2) {
    const cur = finiteDiff[finiteDiff.length - 1], prev = finiteDiff[finiteDiff.length - 2];
    if (cur > 0 && prev <= 0) status = 'bullish cross';
    else if (cur < 0 && prev >= 0) status = 'bearish cross';
    else if (cur > 0) status = 'bullish';
    else status = 'bearish';
  }
  return { macdDiff, macdStatus: status };
}

export function computeLocalIndicators(points) {
  const closes = points.map(p => p.close);
  const highs = points.map(p => p.high);
  const lows = points.map(p => p.low);
  const volumes = points.map(p => p.volume);
  const n = closes.filter(Number.isFinite).length;
  const latest = finite(points.at(-1)?.close);
  const prev = finite(points.at(-2)?.close);

  const changePct = (latest != null && prev) ? round((latest - prev) / prev * 100, 2) : null;
  const sma50 = round(smaLast(closes, 50));
  const sma200 = round(smaLast(closes, 200));
  const ema50 = n >= 50 ? round(emaLast(closes, 50)) : null;

  const lb = Math.min(252, n);
  const winH = highs.filter(Number.isFinite).slice(-lb);
  const winL = lows.filter(Number.isFinite).slice(-lb);
  const high52 = winH.length ? Math.max(...winH) : null;
  const low52 = winL.length ? Math.min(...winL) : null;
  const pos52w = (latest != null && high52 != null && low52 != null && high52 !== low52)
    ? round((latest - low52) / (high52 - low52) * 100, 1) : 50.0;

  const rsi = round(rsiLast(closes, 14));
  const { macdDiff, macdStatus } = macdCross(closes);

  const support = round(Math.min(...lows.filter(Number.isFinite).slice(-Math.min(20, n))));
  const resistance = round(Math.max(...highs.filter(Number.isFinite).slice(-Math.min(20, n))));

  const volWin = volumes.filter(Number.isFinite).slice(-Math.min(20, n));
  const avgVol20 = volWin.length ? volWin.reduce((a, b) => a + b, 0) / volWin.length : 0;
  const todayVol = finite(points.at(-1)?.volume);
  const volRatio = avgVol20 > 0 && todayVol != null ? round(todayVol / avgVol20, 1) : null;

  let bias = 'NEUTRAL';
  if (rsi != null && rsi > 75) bias = 'OVERBOUGHT';
  else if (rsi != null && rsi < 25) bias = 'OVERSOLD';
  else if (['bullish', 'bullish cross'].includes(macdStatus) && sma50 && latest > sma50) bias = 'BULLISH';
  else if (['bearish', 'bearish cross'].includes(macdStatus) && sma50 && latest < sma50) bias = 'BEARISH';

  let score = 0;
  if (sma50 && latest > sma50) score += 1;
  if (sma200 && latest > sma200) score += 1;
  if (macdDiff != null && macdDiff > 0) score += 1;
  if (rsi != null && rsi > 40 && rsi < 70) score += 1;

  let signal = '🟡 n/a';
  if (sma50 != null && sma200 != null && latest != null) {
    const a50 = latest > sma50, a200 = latest > sma200;
    if (a50 && a200) signal = '🟢 >both';
    else if (!a50 && !a200) signal = '🔴 <both';
    else if (a50) signal = '🟡 >50 <200';
    else signal = '🟡 <50 >200';
  }

  return {
    local: {
      changePct, sma50, sma200, ema50, rsi, macdDiff, macdStatus,
      high52, low52, pos52w, support, resistance, bias, score, signal,
      volRatio, avgVol20, dataRows: n,
      // entry/target/stop deliberately NOT exported (Eric 2026-10-18)
    },
  };
}
