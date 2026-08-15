const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet'
];
const NI_CONCEPTS = [
  'NetIncomeLoss',
  'ProfitLoss',
  'NetIncomeLossAvailableToCommonStockholdersBasic',
  'ProfitLossAttributableToOwnersOfParent'
];
const OCF_CONCEPTS = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  'CashFlowsFromUsedInOperatingActivities'
];
const CAPEX_CONCEPTS = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'
];
const ASSET_CONCEPTS = ['Assets'];
const LIAB_CONCEPTS = ['Liabilities'];
const EQUITY_CONCEPTS = [
  'StockholdersEquity',
  'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  'Equity'
];

function finite(n) { return Number.isFinite(n) ? n : null; }
function round(n, d = 2) { return Number.isFinite(n) ? Number(n.toFixed(d)) : null; }

export function factDurationDays(fact) {
  if (!fact?.start || !fact?.end) return null;
  const start = Date.parse(fact.start);
  const end = Date.parse(fact.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86400_000);
}

function calendarPeriod(end, kind) {
  const [y, m] = String(end).split('-').map(Number);
  if (!y || !m) return end;
  if (kind === 'annual') return `${y} FY`;
  if (m <= 3) return `${y} Q1`;
  if (m <= 6) return `${y} Q2`;
  if (m <= 9) return `${y} Q3`;
  return `${y} Q4`;
}

function betterFact(next, prev) {
  if (!prev) return true;
  const nextFrame = /CY\d{4}Q[1-4]$/.test(next.frame || '');
  const prevFrame = /CY\d{4}Q[1-4]$/.test(prev.frame || '');
  if (nextFrame !== prevFrame) return nextFrame;
  if ((next.filed || '') !== (prev.filed || '')) return (next.filed || '') > (prev.filed || '');
  const nd = factDurationDays(next);
  const pd = factDurationDays(prev);
  if (Number.isFinite(nd) && Number.isFinite(pd) && nd !== pd) return nd < pd;
  return false;
}

function collectDuration(facts, names, { minDays, maxDays, forms }) {
  const rows = [];
  for (const ns of ['us-gaap', 'ifrs-full']) {
    for (const name of names) {
      const usd = facts?.[ns]?.[name]?.units?.USD;
      if (!Array.isArray(usd)) continue;
      for (const f of usd) {
        if (!Number.isFinite(f.val) || !f.end) continue;
        if (!forms.includes(f.form)) continue;
        const days = factDurationDays(f);
        if (!Number.isFinite(days) || days < minDays || days > maxDays) continue;
        rows.push({ ...f, _concept: name });
      }
    }
  }
  const byEnd = new Map();
  for (const f of rows) {
    if (betterFact(f, byEnd.get(f.end))) byEnd.set(f.end, f);
  }
  return [...byEnd.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([end, f]) => ({ end, val: round(f.val, 0), form: f.form, filed: f.filed || null, concept: f._concept }));
}

function collectInstant(facts, names, forms) {
  const rows = [];
  for (const ns of ['us-gaap', 'ifrs-full']) {
    for (const name of names) {
      const usd = facts?.[ns]?.[name]?.units?.USD;
      if (!Array.isArray(usd)) continue;
      for (const f of usd) {
        if (!Number.isFinite(f.val) || !f.end) continue;
        if (!forms.includes(f.form)) continue;
        if (f.start) continue;
        rows.push({ ...f, _concept: name });
      }
    }
  }
  const byEnd = new Map();
  for (const f of rows) {
    if (betterFact(f, byEnd.get(f.end))) byEnd.set(f.end, f);
  }
  return new Map([...byEnd.entries()].map(([end, f]) => [end, round(f.val, 0)]));
}

function toMap(rows) {
  return new Map(rows.map((r) => [r.end, r.val]));
}

function fillImpliedQuarters(maps, revA, niA, ocfA, capexA) {
  const annuals = [...revA, ...niA];
  const seen = new Set();
  for (const row of annuals) {
    if (seen.has(row.end)) continue;
    seen.add(row.end);
    const end = row.end;
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() + 1);
    const windowStart = start.toISOString().slice(0, 10);
    const inYear = (m) => [...m.keys()].filter((e) => e > windowStart && e < end);
    const qEnds = [...new Set([...inYear(maps.rev), ...inYear(maps.ni)])];
    if (qEnds.length !== 3) continue;
    const residual = (annualMap, qMap) => {
      const annual = annualMap.get(end);
      if (!Number.isFinite(annual)) return;
      const parts = qEnds.map((e) => qMap.get(e)).filter(Number.isFinite);
      if (parts.length !== 3) return;
      const implied = round(annual - parts.reduce((a, b) => a + b, 0), 0);
      if (!Number.isFinite(implied)) return;
      if (!qMap.has(end)) qMap.set(end, implied);
    };
    residual(toMap(revA), maps.rev);
    residual(toMap(niA), maps.ni);
    residual(toMap(ocfA), maps.ocf);
    residual(toMap(capexA), maps.capex);
  }
}

export function forecastTwo(quarters) {
  const vals = quarters.map((q) => q.revenue).filter(Number.isFinite);
  if (vals.length < 2) return [];
  const last = vals.at(-1);
  const prev = vals.at(-2);
  const growth = last && prev ? Math.max(-0.25, Math.min(0.25, (last - prev) / Math.abs(prev))) : 0;
  return [1, 2].map((i) => ({
    period: `Forecast Q+${i}`,
    value: round(last * (1 + growth) ** i, 0),
    basis: 'simple trend forecast'
  }));
}

function stitch(ends, kind, maps, source) {
  return ends.map((end) => {
    const ocf = maps.ocf.get(end) ?? null;
    const capex = maps.capex.get(end) ?? null;
    const revenue = maps.rev.get(end) ?? null;
    const netIncome = maps.ni.get(end) ?? null;
    return {
      period: calendarPeriod(end, kind),
      end,
      form: kind === 'annual' ? '20-F/10-K' : '10-Q',
      filed: null,
      source,
      value: revenue,
      revenue,
      netIncome,
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: Number.isFinite(ocf) && Number.isFinite(capex) ? round(ocf - Math.abs(capex), 0) : null,
      assets: maps.assets.get(end) ?? null,
      liabilities: maps.liab.get(end) ?? null,
      equity: maps.equity.get(end) ?? null
    };
  }).filter((q) => Number.isFinite(q.revenue) || Number.isFinite(q.netIncome) || Number.isFinite(q.operatingCashFlow));
}

export function buildFinancialsFromFacts(facts, { source = 'SEC' } = {}) {
  const qForms = ['10-Q', '10-K', '20-F'];
  const revQ = collectDuration(facts, REVENUE_CONCEPTS, { minDays: 70, maxDays: 110, forms: qForms });
  const niQ = collectDuration(facts, NI_CONCEPTS, { minDays: 70, maxDays: 110, forms: qForms });
  const ocfQ = collectDuration(facts, OCF_CONCEPTS, { minDays: 70, maxDays: 110, forms: qForms });
  const capexQ = collectDuration(facts, CAPEX_CONCEPTS, { minDays: 70, maxDays: 110, forms: qForms });
  const revA = collectDuration(facts, REVENUE_CONCEPTS, { minDays: 320, maxDays: 380, forms: ['10-K', '20-F'] });
  const niA = collectDuration(facts, NI_CONCEPTS, { minDays: 320, maxDays: 380, forms: ['10-K', '20-F'] });
  const ocfA = collectDuration(facts, OCF_CONCEPTS, { minDays: 320, maxDays: 380, forms: ['10-K', '20-F'] });
  const capexA = collectDuration(facts, CAPEX_CONCEPTS, { minDays: 320, maxDays: 380, forms: ['10-K', '20-F'] });
  const assets = collectInstant(facts, ASSET_CONCEPTS, qForms);
  const liab = collectInstant(facts, LIAB_CONCEPTS, qForms);
  const equity = collectInstant(facts, EQUITY_CONCEPTS, qForms);

  const qEnds = [...new Set([...revQ, ...niQ].map((r) => r.end))].sort();
  if (qEnds.length >= 2) {
    const maps = {
      rev: toMap(revQ), ni: toMap(niQ), ocf: toMap(ocfQ), capex: toMap(capexQ), assets, liab, equity
    };
    fillImpliedQuarters(maps, revA, niA, ocfA, capexA);
    const ends = [...new Set([...qEnds, ...maps.rev.keys(), ...maps.ni.keys()])].sort();
    const quarters = stitch(ends.slice(-8), 'quarter', maps, source);
    return { quarters, forecast: forecastTwo(quarters), source, basis: 'quarterly' };
  }

  const aEnds = [...new Set([...revA, ...niA].map((r) => r.end))].sort();
  if (aEnds.length) {
    const quarters = stitch(aEnds.slice(-4), 'annual', {
      rev: toMap(revA), ni: toMap(niA), ocf: toMap(ocfA), capex: toMap(capexA), assets, liab, equity
    }, source);
    return { quarters, forecast: [], source, basis: 'annual' };
  }

  return { quarters: [], forecast: [], source: 'none', basis: 'none' };
}

export function uniqueStatementRows(rows) {
  const byEnd = new Map();
  for (const q of rows || []) {
    if (!q?.end) continue;
    const prev = byEnd.get(q.end);
    if (!prev) byEnd.set(q.end, q);
  }
  const uniq = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
  const quarterly = uniq.filter((q) => !/FY/i.test(q.period || ''));
  if (quarterly.length) return quarterly;
  return uniq;
}
