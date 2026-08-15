const DATA_URL = './public/data/latest.json';
const PANES = ['chart', 'flow', 'financial', 'insider', 'alerts'];
const CHART_INK = {
  grid: 'rgba(140, 154, 170, .12)',
  tick: '#8b97a8',
  blue: '#6cb6ff',
  green: '#3dcc8a',
  gold: '#e6c36a',
  red: '#f07178',
  muted: '#8b97a8'
};

let latestData = null;
let selectedSymbol = 'VST';
let activePane = 'chart';
let chartRange = 260;
let emaChart, macdChart, rsiChart, financialChart;

const $ = (id) => document.getElementById(id);

const cls = (n) => Number.isFinite(n) ? (n > 0 ? 'up' : n < 0 ? 'down' : 'flat') : 'flat';
const sign = (n) => Number.isFinite(n) && n > 0 ? '+' : '';

function fmtMoney(n, digits) {
  if (!Number.isFinite(n)) return '—';
  const d = digits ?? (Math.abs(n) >= 100 ? 2 : 2);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

function fmtCompact(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

function fmtShares(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPct(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return `${sign(n)}${n.toFixed(digits)}%`;
}

function fmtRatio(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(digits);
}

function displayName(s) {
  return String(s.name || s.symbol)
    .replace(/\s+Common Stock$/i, '')
    .replace(/\s+Ordinary Shares.*$/i, '')
    .replace(/\s+Class [A-Z].*$/i, '')
    .trim();
}

function titleCase(str) {
  if (!str) return '—';
  return String(str)
    .toLowerCase()
    .replace(/(^|[\s-/])([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\bTv\b/g, 'TV')
    .replace(/\bUs\b/g, 'US');
}

function dayChg(s) {
  let prev = s.previousClose;
  const prior = (s.technical || []).at(-2)?.close;
  if (Number.isFinite(s.price) && Number.isFinite(prev) && prev) {
    const raw = ((s.price - prev) / prev) * 100;
    if (Math.abs(raw) > 35 && Number.isFinite(prior)) prev = prior;
  } else if (Number.isFinite(prior)) {
    prev = prior;
  }
  if (!Number.isFinite(s.price) || !Number.isFinite(prev) || !prev) return { abs: null, pct: null };
  const abs = s.price - prev;
  return { abs, pct: (abs / prev) * 100 };
}

function lastTech(s) {
  const t = s.technical || [];
  return t[t.length - 1] || {};
}

function shortRatio(s) {
  const latest = s.shortVolume?.latest?.shortVolumeRatio;
  if (Number.isFinite(latest)) return latest;
  return s.unusualActivity?.shortVolumeRatio;
}

function vsEma(s) {
  const last = lastTech(s);
  if (!Number.isFinite(s.price) || !Number.isFinite(last.ema50) || !last.ema50) return null;
  return ((s.price - last.ema50) / last.ema50) * 100;
}

function edgarUrl(cik, accession) {
  if (!cik || !accession) return null;
  const cikNum = String(cik).replace(/^0+/, '');
  const acc = String(accession).replace(/-/g, '');
  if (!cikNum || !acc) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${accession}-index.html`;
}

function uniqueQuarters(rows) {
  const byEnd = new Map();
  for (const q of rows || []) {
    if (!q?.end || /FY/i.test(q.period || '')) continue;
    const prev = byEnd.get(q.end);
    const endY = q.end.slice(0, 4);
    if (!prev || String(q.period || '').includes(endY)) byEnd.set(q.end, q);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function computedRatios(s) {
  const out = [];
  if (Number.isFinite(s.peRatio)) out.push({ label: 'P/E', value: fmtRatio(s.peRatio), src: 'feed' });
  const r = s.ratios || {};
  const map = [
    ['P/E', r.pe, (v) => fmtRatio(v)],
    ['P/S', r.ps, (v) => fmtRatio(v)],
    ['EV/EBITDA', r.evToEbitda, (v) => fmtRatio(v)],
    ['ROE', r.roe, (v) => (Math.abs(v) <= 2 ? fmtPct(v * 100) : fmtPct(v))],
    ['D/E', r.debtToEquity, (v) => fmtRatio(v)],
    ['Current', r.currentRatio, (v) => fmtRatio(v)],
    ['FCF', r.freeCashFlow, (v) => fmtCompact(v)],
    ['Div yld', r.dividendYield, (v) => (Math.abs(v) <= 1 ? fmtPct(v * 100) : fmtPct(v))]
  ];
  for (const [label, val, fn] of map) {
    if (!Number.isFinite(val)) continue;
    if (out.some((x) => x.label === label)) continue;
    out.push({ label, value: fn(val), src: 'feed' });
  }

  const qs = uniqueQuarters(s.financials?.quarters).slice(-4);
  if (qs.length) {
    const ttmRev = qs.reduce((a, q) => a + (Number(q.revenue) || 0), 0);
    const ttmNi = qs.reduce((a, q) => a + (Number(q.netIncome) || 0), 0);
    const ttmFcf = qs.reduce((a, q) => a + (Number(q.freeCashFlow) || 0), 0);
    const last = qs[qs.length - 1];
    if (Number.isFinite(s.marketCap) && ttmRev > 0 && !out.some((x) => x.label === 'P/S')) {
      out.push({ label: 'P/S', value: fmtRatio(s.marketCap / ttmRev), src: 'TTM calc' });
    }
    if (Number.isFinite(s.marketCap) && ttmNi > 0 && !out.some((x) => x.label === 'P/E')) {
      out.push({ label: 'P/E', value: fmtRatio(s.marketCap / ttmNi), src: 'TTM calc' });
    }
    if (Number.isFinite(last?.equity) && last.equity > 0 && !out.some((x) => x.label === 'ROE')) {
      out.push({ label: 'ROE', value: fmtPct((ttmNi / last.equity) * 100), src: 'TTM calc' });
    }
    if (ttmFcf && !out.some((x) => x.label === 'FCF')) {
      out.push({ label: 'FCF TTM', value: fmtCompact(ttmFcf), src: 'TTM calc' });
    }
  }
  return out;
}

function sparkPath(series) {
  const pts = (series || []).slice(-60).map((p) => p.value ?? p.close).filter(Number.isFinite);
  if (pts.length < 2) return '';
  const w = 56;
  const h = 18;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  return pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function selected() {
  return latestData?.symbols?.find((s) => s.symbol === selectedSymbol) || latestData?.symbols?.[0];
}

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  if (!raw) return {};
  const [a, b] = raw.split('/');
  if (PANES.includes(a) && !b) return { pane: a };
  const pane = PANES.includes(b) ? b : PANES.includes(a) ? a : null;
  const symbol = PANES.includes(a) ? null : (a || '').toUpperCase();
  return { symbol, pane };
}

function writeHash() {
  const next = `#${selectedSymbol}/${activePane}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function applyHash() {
  const { symbol, pane } = parseHash();
  if (symbol && latestData?.symbols?.some((s) => s.symbol === symbol)) selectedSymbol = symbol;
  if (pane) activePane = pane;
}

function setNav() {
  document.querySelectorAll('[data-pane]').forEach((el) => {
    const on = el.dataset.pane === activePane;
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    if (el.tagName === 'A') el.href = `#${selectedSymbol}/${el.dataset.pane}`;
  });
  PANES.forEach((p) => {
    const node = $(`pane-${p}`);
    if (node) node.hidden = p !== activePane;
  });
}

function renderStatus(data) {
  const g = new Date(data.generatedAt);
  const ageMin = (Date.now() - g.getTime()) / 60000;
  const stale = ageMin > (data.staleAfterMinutes || 1440);
  const fresh = String(data.dataStatus || '').toLowerCase() === 'fresh';
  const label = stale && !fresh ? 'STALE' : fresh ? 'FRESH' : 'LIVE';
  const pill = $('status-pill');
  pill.textContent = label;
  pill.className = `status ${label === 'STALE' ? 'stale' : 'live'}`;
  $('asof').textContent = `As of ${g.toLocaleString()} · ${data.source ? 'Massive / SEC' : 'local JSON'}`;
  document.querySelector('.live-dot')?.classList.toggle('stale', label === 'STALE');
}

function renderQuote(s) {
  const chg = dayChg(s);
  const last = lastTech(s);
  const ema = vsEma(s);
  const short = shortRatio(s);
  $('q-symbol').textContent = s.symbol;
  $('q-name').textContent = displayName(s);
  const cells = [
    ['Last', fmtMoney(s.price), ''],
    ['Day', `${fmtMoney(chg.abs)}  ${fmtPct(chg.pct)}`, cls(chg.pct)],
    ['YTD', fmtPct(s.ytdPct), cls(s.ytdPct)],
    ['RSI', fmtRatio(s.rsi14 ?? last.rsi14), Number(s.rsi14) >= 70 ? 'down' : Number(s.rsi14) <= 30 ? 'up' : ''],
    ['vs EMA50', fmtPct(ema), cls(ema)],
    ['Short', Number.isFinite(short) ? `${short.toFixed(1)}%` : '—', short >= 50 ? 'warn' : ''],
    ['Vol', fmtShares(s.unusualActivity?.volume || s.avgVolume), '']
  ];
  $('quote-metrics').innerHTML = cells.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join('');
}

function renderWatch(symbols) {
  $('book-count').textContent = `${symbols.length} names`;
  $('watch-body').innerHTML = symbols.map((s) => {
    const chg = dayChg(s);
    const short = shortRatio(s);
    const on = s.symbol === selectedSymbol ? 'on' : '';
    const d = sparkPath(s.series);
    const stroke = (s.ytdPct || 0) >= 0 ? '#3dcc8a' : '#f07178';
    return `<tr class="${on}" data-symbol="${s.symbol}" tabindex="0">
      <td><b>${s.symbol}</b></td>
      <td class="num mono">${fmtMoney(s.price)}</td>
      <td class="num ${cls(chg.pct)}">${fmtPct(chg.pct)}</td>
      <td class="num ${cls(s.ytdPct)}">${fmtPct(s.ytdPct)}</td>
      <td class="num mono">${Number.isFinite(short) ? `${short.toFixed(1)}` : '—'}</td>
      <td><svg class="spark" viewBox="0 0 56 18" aria-hidden="true"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.2"/></svg></td>
    </tr>`;
  }).join('');
}

function chartOpts(extra = {}) {
  const yTicks = extra.compactY
    ? { color: CHART_INK.tick, callback: (v) => fmtCompact(v) }
    : { color: CHART_INK.tick };
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: CHART_INK.tick, boxWidth: 10, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: CHART_INK.tick, maxTicksLimit: 6 }, grid: { color: CHART_INK.grid } },
      y: { ticks: yTicks, grid: { color: CHART_INK.grid }, ...(extra.y || {}) }
    }
  };
}

function line(canvas, datasets, labels, extra) {
  const parent = canvas.parentElement;
  if (parent && !parent.style.height) parent.style.minHeight = `${canvas.getAttribute('height') || 140}px`;
  return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: chartOpts(extra) });
}

function sliceTech(s) {
  const t = s.technical || [];
  return t.slice(Math.max(0, t.length - chartRange));
}

function renderTechnical(s) {
  const t = sliceTech(s);
  const labels = t.map((p) => p.date);
  const last = t[t.length - 1] || {};
  $('chart-readout').textContent = `${s.symbol} last ${fmtMoney(s.price)} · EMA50 ${fmtMoney(last.ema50)} · RSI ${fmtRatio(last.rsi14)} · MACD hist ${fmtRatio(last.macdHist, 2)}`;
  document.querySelectorAll('[data-range]').forEach((btn) => btn.classList.toggle('on', Number(btn.dataset.range) === chartRange));
  if (emaChart) emaChart.destroy();
  if (macdChart) macdChart.destroy();
  if (rsiChart) rsiChart.destroy();
  const slim = { pointRadius: 0, tension: 0.15, borderWidth: 1.6 };
  emaChart = line($('ema-chart'), [
    { label: 'Close', data: t.map((p) => p.close), borderColor: CHART_INK.blue, ...slim },
    { label: 'EMA50', data: t.map((p) => p.ema50), borderColor: CHART_INK.green, ...slim }
  ], labels);
  macdChart = line($('macd-chart'), [
    { label: 'MACD', data: t.map((p) => p.macd), borderColor: CHART_INK.blue, ...slim },
    { label: 'Signal', data: t.map((p) => p.macdSignal), borderColor: CHART_INK.gold, ...slim },
    { label: 'Hist', data: t.map((p) => p.macdHist), borderColor: CHART_INK.red, backgroundColor: 'rgba(240,113,120,.18)', ...slim }
  ], labels);
  rsiChart = line($('rsi-chart'), [
    { label: 'RSI', data: t.map((p) => p.rsi14), borderColor: CHART_INK.green, ...slim },
    { label: '70', data: t.map(() => 70), borderColor: CHART_INK.red, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
    { label: '30', data: t.map(() => 30), borderColor: CHART_INK.blue, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }
  ], labels, { y: { min: 0, max: 100 } });

  const rows = latestData.symbols.map((x) => {
    const c = dayChg(x);
    const sh = shortRatio(x);
    return `<tr class="${x.symbol === s.symbol ? 'on' : ''}" data-symbol="${x.symbol}">
      <td><b>${x.symbol}</b></td>
      <td class="num">${fmtMoney(x.price)}</td>
      <td class="num ${cls(c.pct)}">${fmtPct(c.pct)}</td>
      <td class="num ${cls(x.ytdPct)}">${fmtPct(x.ytdPct)}</td>
      <td class="num">${fmtRatio(x.rsi14)}</td>
      <td class="num">${Number.isFinite(sh) ? `${sh.toFixed(1)}%` : '—'}</td>
    </tr>`;
  }).join('');
  $('peer-table').innerHTML = `<thead><tr><th>Name</th><th class="num">Last</th><th class="num">Day</th><th class="num">YTD</th><th class="num">RSI</th><th class="num">Short</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderFlow(s) {
  const flow = s.shortVolume || {};
  const latest = flow.latest || {};
  const act = s.unusualActivity || {};
  const metrics = [
    ['Short vol', fmtShares(latest.shortVolume)],
    ['Short ratio', Number.isFinite(latest.shortVolumeRatio) ? `${latest.shortVolumeRatio.toFixed(1)}%` : '—'],
    ['20D avg', Number.isFinite(flow.avgShortVolumeRatio20) ? `${flow.avgShortVolumeRatio20.toFixed(1)}%` : '—'],
    ['Total vol', fmtShares(latest.totalVolume)],
    ['Vol spike', Number.isFinite(act.volumeMultiple) ? `${act.volumeMultiple.toFixed(2)}x` : '—'],
    ['Day range', Number.isFinite(act.dayRangePct) ? `${act.dayRangePct.toFixed(1)}%` : '—'],
    ['Open gap', Number.isFinite(act.gapPct) ? fmtPct(act.gapPct, 2) : '—']
  ].filter(([, v]) => v !== '—');
  $('flow-metrics').innerHTML = metrics.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  const asOf = act.asOf || latest.date || '—';
  $('flow-summary').textContent = `${s.symbol} · ${asOf}. ${act.summary || 'No unusual aggregate activity detected.'}`;
  const sigs = act.signals?.length ? act.signals : [{ label: 'No unusual aggregate activity.', severity: 'info' }];
  $('flow-signals').innerHTML = sigs.map((sig) => `<div class="event"><b>${s.symbol}</b> ${sig.label || sig}</div>`).join('');
  const hist = flow.history || [];
  $('short-volume-table').innerHTML = `<thead><tr><th>Date</th><th class="num">Short</th><th class="num">Total</th><th class="num">Ratio</th></tr></thead><tbody>${
    hist.length
      ? hist.map((r) => `<tr><td>${r.date}</td><td class="num">${fmtShares(r.shortVolume)}</td><td class="num">${fmtShares(r.totalVolume)}</td><td class="num">${Number.isFinite(r.shortVolumeRatio) ? `${r.shortVolumeRatio.toFixed(1)}%` : '—'}</td></tr>`).join('')
      : '<tr><td colspan="4">No short-volume rows for this name.</td></tr>'
  }</tbody>`;
}

function renderFinancial(s) {
  const c = s.company || {};
  $('fin-kicker').textContent = titleCase(c.industry) || 'Profile';
  $('fin-name').textContent = displayName(s);
  $('fin-desc').textContent = c.description || 'No profile text in the last refresh.';
  const meta = [
    ['Industry', titleCase(c.industry)],
    ['Mkt cap', fmtCompact(s.marketCap)],
    ['Employees', Number.isFinite(c.employees) ? c.employees.toLocaleString() : '—'],
    ['Home', c.homepage ? `<a href="${c.homepage}" target="_blank" rel="noopener">site</a>` : '—']
  ];
  $('fin-meta').innerHTML = meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const ratios = computedRatios(s);
  $('ratio-grid').innerHTML = ratios.length
    ? ratios.map((r) => `<div class="stat"><span>${r.label}</span><b>${r.value}</b><small>${r.src}</small></div>`).join('')
    : '<p class="empty">No usable ratios in the feed. Statements are below.</p>';
  const qs = uniqueQuarters(s.financials?.quarters);
  const forecasts = s.financials?.forecast || [];
  const body = qs.length
    ? qs.map((q) => `<tr><td>${q.period}<br><small class="flat">${q.end || ''}</small></td><td class="num">${fmtCompact(q.revenue)}</td><td class="num ${cls(q.netIncome)}">${fmtCompact(q.netIncome)}</td><td class="num">${fmtCompact(q.operatingCashFlow)}</td><td class="num ${cls(q.freeCashFlow)}">${fmtCompact(q.freeCashFlow)}</td></tr>`).join('')
    : '<tr><td colspan="5">No quarterly statements in the last refresh.</td></tr>';
  $('financial-table').innerHTML = `<thead><tr><th>Period</th><th class="num">Rev</th><th class="num">NI</th><th class="num">OCF</th><th class="num">FCF</th></tr></thead><tbody>${body}${
    forecasts.map((f) => `<tr><td class="warn">${f.period}</td><td class="num warn">${fmtCompact(f.value)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`).join('')
  }</tbody>`;
  const labels = [...qs.map((q) => q.period), ...forecasts.map((f) => f.period)];
  const reported = qs.map((q) => q.revenue).concat(forecasts.map(() => null));
  const forecast = qs.map(() => null).concat(forecasts.map((f) => f.value));
  if (financialChart) financialChart.destroy();
  financialChart = line($('financial-chart'), [
    { label: 'Reported', data: reported, borderColor: CHART_INK.blue, pointRadius: 3, tension: 0 },
    { label: 'Trend', data: forecast, borderColor: CHART_INK.gold, borderDash: [5, 4], pointRadius: 3, tension: 0 }
  ], labels, { compactY: true });
}

function matchAccession(s, row) {
  if (row.accessionNumber) return row.accessionNumber;
  const owner = String(row.owner || '').toLowerCase();
  for (const f of s.insider || []) {
    if (String(f.owner || '').toLowerCase() !== owner) continue;
    const tx = (f.transactions || []).find((t) => t.date === row.date && (!row.type || t.type === row.type));
    if (tx || f.reportDate === row.date || f.filingDate === row.date) return f.accessionNumber;
  }
  return null;
}

function filingLink(s, row) {
  const url = row.filingUrl || row.url || edgarUrl(s.cik, row.accessionNumber || matchAccession(s, row));
  return url ? `<a href="${url}" target="_blank" rel="noopener">EDGAR</a>` : '—';
}

function renderInsider(s) {
  const sum = s.insiderSummary || {};
  const sent = String(sum.sentiment || 'NEUTRAL').replaceAll('_', ' ');
  const sentCls = /BULL/i.test(sent) ? 'up' : /BEAR/i.test(sent) ? 'down' : 'flat';
  const strip = [
    ['Sentiment', sent, sentCls],
    ['Score', `${sum.score ?? '—'}/100`, ''],
    ['Buy / Sell', `${sum.buyCount || 0} / ${sum.sellCount || 0}`, ''],
    ['Net sh', fmtShares(sum.netShares), cls(sum.netShares)],
    ['Bought', fmtCompact(sum.totalBought), 'up'],
    ['Sold', fmtCompact(sum.totalSold), 'down']
  ];
  $('insider-strip').innerHTML = strip.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`).join('');

  const holders = sum.keyInsiders || [];
  $('key-insiders').innerHTML = holders.length
    ? holders.map((i) => `<div class="row"><div><b>${i.owner}</b><small>${i.title || 'Insider'} · ${i.txCount} tx</small></div><div class="right"><span class="${cls(i.netShares)}">${fmtShares(i.netShares)} sh</span><small>Sold ${fmtCompact(i.soldValue)}</small></div></div>`).join('')
    : '<p class="empty">No open-market insider rows.</p>';

  const large = sum.largestTransactions || [];
  $('largest-transactions').innerHTML = large.length
    ? large.map((t) => `<div class="row"><div><b>${t.owner}</b><small>${t.date} · ${t.title || ''}</small></div><div class="right"><span class="${t.type === 'BUY' ? 'up' : 'down'}">${t.type} ${fmtShares(t.shares)}</span><small>${fmtMoney(t.price)} · ${fmtCompact(t.value)} · ${filingLink(s, t)}</small></div></div>`).join('')
    : '<p class="empty">No priced prints.</p>';

  $('insider-patterns').innerHTML = (sum.patterns?.length ? sum.patterns : ['No strong open-market pattern.']).map((p) => `<li>${p}</li>`).join('');
  $('insider-alerts').innerHTML = (sum.alerts?.length ? sum.alerts : ['No major flags.']).map((p) => `<li>${p}</li>`).join('');

  const rows = s.insider || [];
  $('insider-table').innerHTML = `<thead><tr><th>Date</th><th>Insider</th><th>Type</th><th class="num">Shares</th><th class="num">Value</th><th>Filing</th></tr></thead><tbody>${
    rows.length
      ? rows.map((f) => {
        const tx = (f.transactions || []).find((t) => ['BUY', 'SELL'].includes(t.type)) || (f.transactions || [])[0] || {};
        const href = filingLink(s, { ...f, accessionNumber: f.accessionNumber });
        return `<tr><td>${tx.date || f.reportDate || f.filingDate || '—'}</td><td>${f.owner || 'Unknown'}<br><small class="flat">${f.title || ''}</small></td><td class="${tx.type === 'BUY' ? 'up' : tx.type === 'SELL' ? 'down' : 'flat'}">${tx.type || f.dominantType || '4'}</td><td class="num">${fmtShares(tx.shares)}</td><td class="num">${fmtCompact(tx.value)}</td><td>${href}</td></tr>`;
      }).join('')
      : '<tr><td colspan="6">No Form 4 rows.</td></tr>'
  }</tbody>`;
}

function collapseAlerts(alerts) {
  const last = new Map();
  for (const a of alerts || []) {
    if (!last.has(a.symbol)) last.set(a.symbol, a);
  }
  return [...last.values()];
}

function renderAlerts(data) {
  const sum = data.summary || {};
  const best = sum.bestPerformer ? `${sum.bestPerformer.symbol} ${fmtPct(sum.bestPerformer.ytdPct)}` : '—';
  const worst = sum.worstPerformer ? `${sum.worstPerformer.symbol} ${fmtPct(sum.worstPerformer.ytdPct)}` : '—';
  $('portfolio-metrics').innerHTML = [
    ['Names', String(data.symbols.length)],
    ['Avg RSI', fmtRatio(sum.avgRsi14)],
    ['Book score', `${sum.sentimentScore ?? '—'}/100`],
    ['Best YTD', `<span class="up">${best}</span>`],
    ['Worst YTD', `<span class="down">${worst}</span>`],
    ['Refresh', '05:00 ICT']
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const collapsed = collapseAlerts(data.alerts);
  $('alert-count').textContent = `${collapsed.length}`;
  $('alerts-list').innerHTML = collapsed.length
    ? collapsed.map((a) => `<div class="event" data-symbol="${a.symbol}"><b>${a.symbol}</b> ${a.message}<small>${new Date(a.createdAt).toLocaleString()}</small></div>`).join('')
    : '<p class="empty">No alerts.</p>';
}

function renderDesk() {
  const s = selected();
  if (!s) return;
  selectedSymbol = s.symbol;
  renderQuote(s);
  renderWatch(latestData.symbols);
  setNav();
  if (activePane === 'chart') renderTechnical(s);
  if (activePane === 'flow') renderFlow(s);
  if (activePane === 'financial') renderFinancial(s);
  if (activePane === 'insider') renderInsider(s);
  if (activePane === 'alerts') renderAlerts(latestData);
  writeHash();
}

function selectSymbol(sym) {
  if (!latestData?.symbols?.some((s) => s.symbol === sym)) return;
  selectedSymbol = sym;
  renderDesk();
}

function moveSelection(delta) {
  const list = latestData?.symbols || [];
  const i = list.findIndex((s) => s.symbol === selectedSymbol);
  const next = list[(i + delta + list.length) % list.length];
  if (next) selectSymbol(next.symbol);
}

async function loadData() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Data fetch failed: ${res.status}`);
  return res.json();
}

async function render({ manual = false } = {}) {
  const btn = $('refresh-btn');
  try {
    if (manual) {
      btn.disabled = true;
      btn.textContent = 'Refreshing';
    }
    latestData = await loadData();
    applyHash();
    if (!latestData.symbols.some((s) => s.symbol === selectedSymbol)) {
      selectedSymbol = latestData.symbols[0].symbol;
    }
    renderStatus(latestData);
    renderDesk();
    if (manual) {
      btn.textContent = 'Updated';
      setTimeout(() => { btn.textContent = 'Refresh'; btn.disabled = false; }, 900);
    }
  } catch (err) {
    $('status-pill').className = 'status err';
    $('status-pill').textContent = 'ERROR';
    $('asof').textContent = err.message;
    document.querySelector('.live-dot')?.classList.add('err');
    if (manual) {
      btn.textContent = 'Retry';
      btn.disabled = false;
    }
    console.error(err);
  }
}

function bind() {
  $('refresh-btn').addEventListener('click', () => render({ manual: true }));
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-symbol]');
    if (row?.dataset.symbol) selectSymbol(row.dataset.symbol);
    const range = e.target.closest('[data-range]');
    if (range) {
      chartRange = Number(range.dataset.range);
      if (activePane === 'chart') renderTechnical(selected());
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'j') { e.preventDefault(); moveSelection(1); }
    if (e.key === 'k') { e.preventDefault(); moveSelection(-1); }
    if (e.key >= '1' && e.key <= '5') {
      activePane = PANES[Number(e.key) - 1];
      renderDesk();
    }
  });
  window.addEventListener('hashchange', () => {
    applyHash();
    renderDesk();
  });
}

bind();
render();
setInterval(render, 60000);
