const TYPES = [
  'quarterlyTotalRevenue',
  'quarterlyNetIncomeCommonStockholders',
  'quarterlyNetIncome',
  'quarterlyOperatingCashFlow',
  'quarterlyCapitalExpenditure',
  'quarterlyFreeCashFlow',
  'quarterlyTotalAssets',
  'quarterlyStockholdersEquity'
];

function finite(n) { return Number.isFinite(n) ? n : null; }
function round(n, d = 0) { return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }

function periodLabel(end) {
  const [y, m] = String(end).split('-').map(Number);
  if (!y || !m) return end;
  if (m <= 3) return `${y} Q1`;
  if (m <= 6) return `${y} Q2`;
  if (m <= 9) return `${y} Q3`;
  return `${y} Q4`;
}

function pickRaw(item) {
  const v = item?.reportedValue?.raw ?? item?.reportedValue;
  return finite(Number(v));
}

export async function fetchYahooQuarterlies(symbol, { years = 3 } = {}) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - years * 366 * 86400;
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?lang=en-US&region=US&type=${TYPES.join(',')}&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'nexus-stock-dashboard/1.0' } });
  if (!res.ok) throw new Error(`Yahoo financials ${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const blocks = json?.timeseries?.result || [];
  const byEnd = new Map();
  for (const block of blocks) {
    for (const [key, rows] of Object.entries(block)) {
      if (key === 'meta' || key === 'timestamp' || !Array.isArray(rows)) continue;
      for (const row of rows) {
        const end = row.asOfDate;
        if (!end || row.periodType !== '3M') continue;
        const q = byEnd.get(end) || {
          period: periodLabel(end),
          end,
          form: 'Yahoo',
          source: 'Yahoo',
          value: null,
          revenue: null,
          netIncome: null,
          operatingCashFlow: null,
          capex: null,
          freeCashFlow: null,
          assets: null,
          equity: null
        };
        const val = pickRaw(row);
        if (key.includes('TotalRevenue')) { q.revenue = round(val); q.value = q.revenue; }
        else if (key.includes('NetIncome')) q.netIncome = q.netIncome ?? round(val);
        else if (key.includes('OperatingCashFlow')) q.operatingCashFlow = round(val);
        else if (key.includes('CapitalExpenditure')) q.capex = round(val);
        else if (key.includes('FreeCashFlow')) q.freeCashFlow = round(val);
        else if (key.includes('TotalAssets')) q.assets = round(val);
        else if (key.includes('StockholdersEquity')) q.equity = round(val);
        byEnd.set(end, q);
      }
    }
  }
  const quarters = [...byEnd.values()]
    .map((q) => {
      if (!Number.isFinite(q.freeCashFlow) && Number.isFinite(q.operatingCashFlow) && Number.isFinite(q.capex)) {
        q.freeCashFlow = round(q.operatingCashFlow - Math.abs(q.capex));
      }
      return q;
    })
    .filter((q) => Number.isFinite(q.revenue) || Number.isFinite(q.netIncome))
    .sort((a, b) => a.end.localeCompare(b.end));
  if (!quarters.length) return null;
  return { quarters: quarters.slice(-8), forecast: [], source: 'Yahoo', basis: 'quarterly' };
}
