#!/usr/bin/env node
const SYMBOLS = (process.env.STOCK_SYMBOLS || 'VST,RGTI,IONQ,LAC,UAMY,SNPS,QCOM,RRX')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const OUT = new URL('../public/data/latest.json', import.meta.url);
const FALLBACK = new URL('../public/data/fallback.json', import.meta.url);
const SEC_UA = process.env.SEC_USER_AGENT || 'nexus-stock-dashboard/1.0 contact@example.com';
const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SENSITIVE_KEYS = ['MASSIVE_API_KEY', 'POLYGON_API_KEY', MASSIVE_API_KEY].filter(Boolean);

function finite(n) { return Number.isFinite(n) ? n : null; }
function round(n, d = 2) { return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }
function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null; }
function redact(value) {
  let text = String(value ?? '');
  for (const secret of SENSITIVE_KEYS) text = text.split(secret).join('[REDACTED]');
  return text.replace(/([?&](?:apiKey|apikey|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}
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
  if (!res.ok) throw new Error(`${redact(url)} HTTP ${res.status}`);
  return res.json();
}
async function fetchChart(symbol) {
  return (await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false&events=div%2Csplits`)).chart?.result?.[0];
}
function isoDateDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}
async function fetchMassiveJson(url) {
  return fetchJson(url, { Authorization: `Bearer ${MASSIVE_API_KEY}` });
}
function massiveUrl(path, params = {}) {
  const url = new URL(path, 'https://api.massive.com');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
}
async function fetchMassiveTickerDetails(symbol) {
  const data = await fetchMassiveJson(massiveUrl(`/v3/reference/tickers/${encodeURIComponent(symbol)}`));
  return data.results || null;
}
async function fetchMassiveBase(symbol, details = {}) {
  const from = isoDateDaysAgo(370);
  const to = new Date().toISOString().slice(0, 10);
  const aggUrl = massiveUrl(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}`, { adjusted: 'true', sort: 'asc', limit: 5000 });
  const bars = await fetchMassiveJson(aggUrl);
  if (!Array.isArray(bars.results) || !bars.results.length) throw new Error('Massive returned no aggregate bars');
  return normalizeMassiveChart(symbol, bars.results, details);
}
async function fetchMassiveRatios(symbol) {
  const data = await fetchMassiveJson(massiveUrl('/stocks/financials/v1/ratios', { ticker: symbol, limit: 1, sort: 'date.desc' }));
  const row = Array.isArray(data.results) ? data.results[0] : null;
  if (!row) return null;
  return {
    date: row.date || null,
    pe: round(finite(row.price_to_earnings), 2),
    pb: round(finite(row.price_to_book), 2),
    ps: round(finite(row.price_to_sales), 2),
    evToEbitda: round(finite(row.ev_to_ebitda), 2),
    roe: round(finite(row.return_on_equity), 3),
    roa: round(finite(row.return_on_assets), 3),
    debtToEquity: round(finite(row.debt_to_equity), 2),
    currentRatio: round(finite(row.current), 2),
    dividendYield: round(finite(row.dividend_yield), 4),
    eps: round(finite(row.earnings_per_share), 2),
    freeCashFlow: round(finite(row.free_cash_flow), 0),
    enterpriseValue: round(finite(row.enterprise_value), 0),
    marketCap: round(finite(row.market_cap), 0)
  };
}
async function fetchMassiveStatement(path, symbol, limit = 8) {
  const data = await fetchMassiveJson(massiveUrl(path, { tickers: symbol, timeframe: 'quarterly', limit, sort: 'period_end.desc' }));
  return Array.isArray(data.results) ? data.results : [];
}
async function fetchMassiveFinancials(symbol) {
  const [income, balance, cashFlow] = await Promise.all([
    fetchMassiveStatement('/stocks/financials/v1/income-statements', symbol),
    fetchMassiveStatement('/stocks/financials/v1/balance-sheets', symbol),
    fetchMassiveStatement('/stocks/financials/v1/cash-flow-statements', symbol)
  ]);
  const byEnd = new Map();
  const rowFor = (row) => {
    const end = row.period_end;
    if (!end) return null;
    const existing = byEnd.get(end) || {
      period: row.fiscal_year && row.fiscal_quarter ? `${row.fiscal_year} Q${row.fiscal_quarter}` : end,
      end,
      form: 'Massive',
      source: 'Massive'
    };
    byEnd.set(end, existing);
    return existing;
  };
  for (const row of income) {
    const q = rowFor(row);
    if (!q) continue;
    q.revenue = round(finite(row.revenue), 0);
    q.netIncome = round(finite(row.net_income_loss_attributable_common_shareholders ?? row.consolidated_net_income_loss), 0);
    q.grossProfit = round(finite(row.gross_profit), 0);
    q.operatingIncome = round(finite(row.operating_income), 0);
    q.eps = round(finite(row.diluted_earnings_per_share ?? row.basic_earnings_per_share), 2);
    q.filingDate = row.filing_date || q.filingDate || null;
  }
  for (const row of cashFlow) {
    const q = rowFor(row);
    if (!q) continue;
    q.operatingCashFlow = round(finite(row.net_cash_flow_from_operating_activities ?? row.operating_cash_flow), 0);
    q.capex = round(finite(row.capital_expenditure ?? row.payments_to_acquire_property_plant_and_equipment), 0);
    q.freeCashFlow = round(finite(row.free_cash_flow), 0);
    if (!Number.isFinite(q.freeCashFlow) && Number.isFinite(q.operatingCashFlow) && Number.isFinite(q.capex)) q.freeCashFlow = round(q.operatingCashFlow - Math.abs(q.capex), 0);
  }
  for (const row of balance) {
    const q = rowFor(row);
    if (!q) continue;
    q.assets = round(finite(row.total_assets), 0);
    q.liabilities = round(finite(row.total_liabilities), 0);
    q.equity = round(finite(row.total_equity ?? row.stockholders_equity), 0);
    q.cash = round(finite(row.cash_and_cash_equivalents ?? row.cash), 0);
    q.debt = round(finite(row.total_debt ?? row.long_term_debt_and_finance_lease_obligations_current_and_noncurrent), 0);
  }
  const quarters = [...byEnd.values()]
    .sort((a, b) => new Date(a.end) - new Date(b.end))
    .slice(-6);
  return quarters.length ? { quarters, forecast: forecastTwo(quarters.map(q => ({ ...q, value: q.revenue }))), source: 'Massive' } : null;
}
async function fetchMassiveInsider(symbol) {
  const data = await fetchMassiveJson(massiveUrl('/stocks/filings/vX/form-4', { tickers: symbol, limit: 40, sort: 'filing_date.desc' }));
  const rows = Array.isArray(data.results) ? data.results : [];
  const byFiling = new Map();
  for (const row of rows) {
    const cls = classifyCode(row.transaction_code, row.transaction_acquired_disposed);
    const shares = finite(row.transaction_shares);
    const price = finite(row.transaction_price_per_share);
    const value = finite(row.transaction_value) ?? (Number.isFinite(shares) && Number.isFinite(price) ? shares * price : null);
    const owner = row.owner_name || 'Unknown insider';
    const key = `${row.accession_number || row.filing_url || row.filing_date || row.period_of_report}-${owner}`;
    const filing = byFiling.get(key) || {
      form: row.form_type || '4',
      reportDate: row.period_of_report || row.transaction_date || row.filing_date,
      filingDate: row.filing_date,
      owner,
      title: row.officer_title || (row.is_director ? 'Director' : row.is_ten_percent_owner ? '10% Owner' : 'Insider'),
      accessionNumber: row.accession_number,
      description: row.security_title || 'SEC Form 4',
      url: row.filing_url,
      source: 'Massive',
      transactions: [],
      netShares: 0,
      boughtValue: 0,
      soldValue: 0,
      dominantType: 'OTHER'
    };
    filing.transactions.push({
      date: row.transaction_date || row.period_of_report || row.filing_date,
      code: row.transaction_code,
      type: cls.type,
      label: cls.label,
      shares: round(shares, 0),
      price: round(price, 2),
      value: round(value, 0),
      sign: cls.sign,
      tenB5One: row.aff_10b5_one === true,
      securityTitle: row.security_title || null
    });
    byFiling.set(key, filing);
  }
  for (const filing of byFiling.values()) {
    const openMarket = filing.transactions.filter(t => ['BUY','SELL'].includes(t.type));
    filing.netShares = round(openMarket.reduce((sum, t) => sum + (t.sign * (t.shares || 0)), 0), 0);
    filing.boughtValue = round(openMarket.filter(t => t.type === 'BUY').reduce((sum, t) => sum + (t.value || 0), 0), 0);
    filing.soldValue = round(openMarket.filter(t => t.type === 'SELL').reduce((sum, t) => sum + (t.value || 0), 0), 0);
    filing.dominantType = filing.soldValue > filing.boughtValue ? 'SELL' : filing.boughtValue > filing.soldValue ? 'BUY' : (filing.transactions[0]?.type || 'OTHER');
  }
  return [...byFiling.values()].slice(0, 8);
}
function normalizeMassiveChart(symbol, bars, details = {}) {
  const points = bars
    .filter(b => Number.isFinite(b.c) && Number.isFinite(b.t))
    .map(b => ({ date: new Date(b.t).toISOString().slice(0, 10), close: round(b.c, 4), high: finite(b.h), low: finite(b.l), volume: finite(b.v) }));
  if (!points.length) throw new Error('Massive aggregate bars contained no close prices');
  const closeValues = points.map(p => p.close);
  const firstTradingDay = points.find(p => p.date >= `${new Date().getUTCFullYear()}-01-01`) || points[0];
  const last = points.at(-1)?.close;
  const ytdPct = pct(last, firstTradingDay?.close);
  const lows = points.map(p => p.low).filter(Number.isFinite);
  const highs = points.map(p => p.high).filter(Number.isFinite);
  const volumes = points.map(p => p.volume).filter(Number.isFinite);
  const week52Low = lows.length ? Math.min(...lows) : null;
  const week52High = highs.length ? Math.max(...highs) : null;
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
    symbol, name: details.name || symbol, exchange: details.primary_exchange || '', currency: (details.currency_name || 'USD').toUpperCase(),
    price: round(last, 2), previousClose: round(points.at(-2)?.close, 2), ytdPct: round(ytdPct, 2),
    marketCap: finite(details.market_cap), peRatio: null, rsi14: round(rsi14, 1), week52Low: round(week52Low, 2), week52High: round(week52High, 2), avgVolume: round(avgVolume, 0),
    recommendation: rec, opportunityScore: rec === 'BUY' ? 78 : rec === 'HOLD' ? 55 : 32,
    company: {
      description: details.description || '',
      homepage: details.homepage_url || '',
      employees: finite(details.total_employees),
      sic: details.sic_code || '',
      industry: details.sic_description || '',
      icon: details.branding?.icon_url || '',
      logo: details.branding?.logo_url || ''
    },
    series: normalized, technical, rawPoints: points.slice(-20).map(({ date, close }) => ({ date, close }))
  };
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
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let text = m[1].replace(/<!\\[CDATA\\[(.*?)\\]\\]>/gs, '$1').trim();
  const valueMatch = text.match(/<value>([\s\S]*?)<\/value>/i);
  if (valueMatch) text = valueMatch[1].trim();
  return text;
}
function blocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'))].map(m => m[1]);
}
function rawSecUrl(cik, accession, document) {
  if (!accession || !document) return null;
  const rawDoc = document.replace(/^xslF345X\d+\//, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${rawDoc}`;
}
function classifyCode(code, ad) {
  if (code === 'P') return { type: 'BUY', sign: 1, label: 'Open-market purchase' };
  if (code === 'S') return { type: 'SELL', sign: -1, label: 'Open-market sale' };
  if (code === 'A') return { type: 'AWARD', sign: ad === 'D' ? -1 : 0, label: 'Grant / award' };
  if (code === 'M') return { type: 'OPTION', sign: 0, label: 'Option exercise / conversion' };
  if (code === 'G') return { type: 'GIFT', sign: 0, label: 'Gift' };
  if (code === 'F') return { type: 'TAX', sign: 0, label: 'Tax withholding' };
  return { type: 'OTHER', sign: ad === 'D' ? -1 : ad === 'A' ? 1 : 0, label: `Code ${code || 'N/A'}` };
}
async function parseForm4(cik, filing) {
  const url = rawSecUrl(cik, filing.accessionNumber, filing.document);
  if (!url) return null;
  const res = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
  if (!res.ok) throw new Error(`Form4 ${res.status}`);
  const xml = await res.text();
  const owner = tagText(xml, 'rptOwnerName') || 'Unknown insider';
  const title = tagText(xml, 'officerTitle') || (tagText(xml, 'isDirector') === '1' || tagText(xml, 'isDirector') === 'true' ? 'Director' : 'Insider');
  const transactions = blocks(xml, 'nonDerivativeTransaction').map(block => {
    const code = tagText(block, 'transactionCode');
    const ad = tagText(block, 'transactionAcquiredDisposedCode') || tagText(block, 'transactionAcquiredDisposedCode/value');
    const cls = classifyCode(code, ad);
    const shares = Number(tagText(block, 'transactionShares').replace(/,/g, ''));
    const price = Number(tagText(block, 'transactionPricePerShare').replace(/,/g, ''));
    const date = tagText(block, 'transactionDate') || tagText(xml, 'periodOfReport');
    const value = Number.isFinite(shares) && Number.isFinite(price) ? shares * price : null;
    return { date, code, type: cls.type, label: cls.label, shares: round(shares, 0), price: round(price, 2), value: round(value, 0), sign: cls.sign };
  }).filter(t => t.date || Number.isFinite(t.shares));
  const openMarket = transactions.filter(t => ['BUY','SELL'].includes(t.type));
  const netShares = openMarket.reduce((sum, t) => sum + (t.sign * (t.shares || 0)), 0);
  const boughtValue = openMarket.filter(t => t.type === 'BUY').reduce((sum,t)=>sum+(t.value||0),0);
  const soldValue = openMarket.filter(t => t.type === 'SELL').reduce((sum,t)=>sum+(t.value||0),0);
  return {
    form: filing.form,
    reportDate: filing.reportDate,
    filingDate: filing.filingDate,
    owner,
    title,
    accessionNumber: filing.accessionNumber,
    description: filing.description,
    url,
    transactions,
    netShares: round(netShares, 0),
    boughtValue: round(boughtValue, 0),
    soldValue: round(soldValue, 0),
    dominantType: soldValue > boughtValue ? 'SELL' : boughtValue > soldValue ? 'BUY' : (transactions[0]?.type || 'OTHER')
  };
}
function summarizeInsider(filings, source = 'SEC') {
  const allTx = filings.flatMap(f => (f.transactions || []).map(t => ({ ...t, owner: f.owner, title: f.title, filingUrl: f.url })));
  const open = allTx.filter(t => ['BUY','SELL'].includes(t.type));
  const totalBought = open.filter(t=>t.type==='BUY').reduce((s,t)=>s+(t.value||0),0);
  const totalSold = open.filter(t=>t.type==='SELL').reduce((s,t)=>s+(t.value||0),0);
  const buyCount = open.filter(t=>t.type==='BUY').length;
  const sellCount = open.filter(t=>t.type==='SELL').length;
  const netShares = open.reduce((s,t)=>s+(t.sign*(t.shares||0)),0);
  const byOwner = new Map();
  for (const t of open) {
    const key = t.owner || 'Unknown insider';
    const row = byOwner.get(key) || { owner: key, title: t.title, boughtValue: 0, soldValue: 0, netShares: 0, txCount: 0 };
    row.boughtValue += t.type === 'BUY' ? (t.value || 0) : 0;
    row.soldValue += t.type === 'SELL' ? (t.value || 0) : 0;
    row.netShares += t.sign * (t.shares || 0);
    row.txCount += 1;
    byOwner.set(key, row);
  }
  const keyInsiders = [...byOwner.values()].map(r => ({ ...r, boughtValue: round(r.boughtValue,0), soldValue: round(r.soldValue,0), netShares: round(r.netShares,0) })).sort((a,b)=>(b.soldValue+b.boughtValue)-(a.soldValue+a.boughtValue)).slice(0,6);
  const largestTransactions = open.sort((a,b)=>(b.value||0)-(a.value||0)).slice(0,8).map(t => ({ owner: t.owner, title: t.title, date: t.date, type: t.type, shares: t.shares, price: t.price, value: t.value, filingUrl: t.filingUrl }));
  let score = 50;
  if (totalBought + totalSold > 0) score += ((totalBought - totalSold) / (totalBought + totalSold)) * 45;
  if (sellCount >= 3 && buyCount === 0) score -= 10;
  if (buyCount >= 2 && sellCount === 0) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const sentiment = score >= 70 ? 'BULLISH' : score >= 55 ? 'SLIGHTLY_BULLISH' : score >= 45 ? 'NEUTRAL' : score >= 30 ? 'BEARISH' : 'VERY_BEARISH';
  const patterns = [];
  if (sellCount >= 3) patterns.push('Cluster selling detected');
  if (buyCount >= 2) patterns.push('Multiple open-market purchases');
  if (keyInsiders.some(i => /CEO|Chief Executive/i.test(i.title || '') && i.soldValue > 0)) patterns.push('CEO selling activity');
  if (keyInsiders.some(i => /CFO|Chief Financial/i.test(i.title || '') && i.soldValue > 0)) patterns.push('CFO selling activity');
  if (!patterns.length) patterns.push('No strong open-market pattern detected');
  const alerts = [];
  if (totalSold > totalBought * 3 && totalSold > 0) alerts.push(`Selling value dominates buying: $${Math.round(totalSold).toLocaleString()} sold`);
  if (totalBought > totalSold * 3 && totalBought > 0) alerts.push(`Accumulation signal: $${Math.round(totalBought).toLocaleString()} bought`);
  if (sellCount >= 5) alerts.push(`${sellCount} sale transactions in recent filings`);
  return { source, sentiment, score, totalTransactions: allTx.length, openMarketTransactions: open.length, buyCount, sellCount, buySellRatio: sellCount ? round(buyCount / sellCount, 2) : buyCount ? 99 : 0, netShares: round(netShares,0), totalBought: round(totalBought,0), totalSold: round(totalSold,0), keyInsiders, largestTransactions, patterns, alerts };
}
async function fetchFinancialAndInsider(symbol, cik, massive = {}) {
  const hasMassiveInsider = Array.isArray(massive.insider) && massive.insider.length > 0;
  if (massive.financials && hasMassiveInsider) return { financials: massive.financials, insider: massive.insider, insiderSummary: summarizeInsider(massive.insider, 'Massive') };
  if (!cik) return { financials: massive.financials || { quarters: [], forecast: [], source: 'none' }, insider: massive.insider || [], insiderSummary: summarizeInsider(massive.insider || [], hasMassiveInsider ? 'Massive' : 'none') };
  const [facts, sub] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`).catch(() => null),
    fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`).catch(() => null)
  ]);
  const revenues = lastQuarters(pickFact(facts?.facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']));
  const netIncome = lastQuarters(pickFact(facts?.facts, ['NetIncomeLoss']));
  const quarters = revenues.map((r) => ({ ...r, source: 'SEC', revenue: r.value, netIncome: netIncome.find(n => n.end === r.end)?.value ?? null }));
  const recent = sub?.filings?.recent || {};
  const basicFilings = (recent.form || []).map((form, i) => ({ form, reportDate: recent.reportDate?.[i], filingDate: recent.filingDate?.[i], accessionNumber: recent.accessionNumber?.[i], document: recent.primaryDocument?.[i], description: recent.primaryDocDescription?.[i] }))
    .filter(f => f.form === '4')
    .slice(0, 8);
  let insider = hasMassiveInsider ? massive.insider : [];
  if (!insider.length) {
    insider = [];
    for (const filing of basicFilings) {
      try {
        const parsed = await parseForm4(cik, filing);
        if (parsed) insider.push({ ...parsed, source: 'SEC' });
      } catch {
        insider.push({ ...filing, source: 'SEC', url: rawSecUrl(cik, filing.accessionNumber, filing.document), transactions: [], netShares: 0, boughtValue: 0, soldValue: 0, dominantType: 'OTHER' });
      }
      await sleep(120);
    }
  }
  const financials = massive.financials || { quarters, forecast: forecastTwo(quarters.map(q => ({...q, value: q.revenue}))), source: 'SEC' };
  return { financials, insider, insiderSummary: summarizeInsider(insider, massive.insider?.length ? 'Massive' : 'SEC') };
}

const results = [], errors = [];
let ciks = {};
try { ciks = await cikMap(); } catch (e) { errors.push({ symbol: 'SEC', error: String(e.message || e) }); }
for (const symbol of SYMBOLS) {
  try {
    let base, profile = null, ratios = null, massiveFinancials = null, massiveInsider = null, priceSource = 'Yahoo';
    if (MASSIVE_API_KEY) {
      try {
        profile = await fetchMassiveTickerDetails(symbol).catch(err => {
          errors.push({ symbol, error: `Massive ticker overview unavailable: ${redact(err.message || err)}` });
          return null;
        });
        base = await fetchMassiveBase(symbol, profile || {});
        priceSource = 'Massive';
        ratios = await fetchMassiveRatios(symbol).catch(err => {
          errors.push({ symbol, error: `Massive ratios unavailable: ${redact(err.message || err)}` });
          return null;
        });
        massiveFinancials = await fetchMassiveFinancials(symbol).catch(err => {
          errors.push({ symbol, error: `Massive financial statements fallback to SEC: ${redact(err.message || err)}` });
          return null;
        });
        massiveInsider = await fetchMassiveInsider(symbol).catch(err => {
          errors.push({ symbol, error: `Massive Form 4 fallback to SEC: ${redact(err.message || err)}` });
          return null;
        });
      } catch (massiveErr) {
        errors.push({ symbol, error: `Massive fallback to Yahoo: ${redact(massiveErr.message || massiveErr)}` });
      }
    }
    if (!base) {
      const chart = await fetchChart(symbol);
      if (!chart) throw new Error('empty chart result');
      base = normalizeChart(symbol, chart);
    }
    if (ratios) {
      base.ratios = ratios;
      base.peRatio = ratios.pe ?? base.peRatio;
      base.marketCap = ratios.marketCap ?? base.marketCap;
    }
    const extra = await fetchFinancialAndInsider(symbol, ciks[symbol] || profile?.cik, { financials: massiveFinancials, insider: massiveInsider });
    results.push({ ...base, cik: ciks[symbol] || profile?.cik || null, dataSources: { price: priceSource, financials: extra.financials?.source || 'SEC', insider: extra.insiderSummary?.source || 'SEC', ratios: ratios ? 'Massive' : 'none', profile: profile ? 'Massive' : 'none' }, ...extra });
  } catch (err) { errors.push({ symbol, error: redact(err.message || err) }); }
  await sleep(MASSIVE_API_KEY ? 13_000 : 350);
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
  source: `${MASSIVE_API_KEY ? 'Massive.com OHLC aggregates' : 'Yahoo Finance chart endpoint'} + SEC companyfacts/submissions via scheduled Node refresh`,
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
