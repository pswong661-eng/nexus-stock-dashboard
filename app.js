const DATA_URL = './public/data/latest.json';
const colors = ['#28e6a3', '#59b4ff', '#a78bfa', '#ffd166', '#ff647c', '#38bdf8', '#f472b6', '#84cc16'];
let comparisonChart;

const $ = (id) => document.getElementById(id);
const fmtMoney = (n, currency = 'USD') => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n) : 'N/A';
const fmtCap = (n) => !Number.isFinite(n) ? 'N/A' : n >= 1e12 ? `$${(n/1e12).toFixed(1)}T` : n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
const fmtNum = (n, suffix = '') => Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : 'N/A';
const cls = (n) => Number.isFinite(n) ? n > 0 ? 'up' : n < 0 ? 'down' : 'flat' : 'flat';
const sign = (n) => Number.isFinite(n) && n > 0 ? '+' : '';

function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000); updateClock();

async function loadData() {
  const url = `${DATA_URL}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Data fetch failed: ${res.status}`);
  return res.json();
}

function renderStatus(data) {
  const generated = new Date(data.generatedAt);
  const ageMin = (Date.now() - generated.getTime()) / 60000;
  const stale = ageMin > (data.staleAfterMinutes || 45);
  const pill = $('status-pill');
  pill.className = `status-pill ${stale ? 'stale' : 'live'}`;
  pill.textContent = `${stale ? 'STALE' : 'LIVE'} · ${data.dataStatus.toUpperCase()} · ${generated.toLocaleString()}`;
}

function renderTickerStrip(symbols) {
  $('ticker-strip').innerHTML = symbols.map(s => `
    <div class="ticker-chip">
      <b>${s.symbol}</b>
      <span>${fmtMoney(s.price, s.currency)}</span><br>
      <small class="${cls(s.ytdPct)}">${sign(s.ytdPct)}${fmtNum(s.ytdPct, '%')} YTD</small>
    </div>
  `).join('');
}

function renderCards(symbols) {
  $('stock-cards').innerHTML = symbols.map(s => {
    const pos = ([s.price, s.week52Low, s.week52High].every(Number.isFinite) && s.week52High > s.week52Low)
      ? Math.max(0, Math.min(100, ((s.price - s.week52Low) / (s.week52High - s.week52Low)) * 100)) : 0;
    return `
      <article class="stock-card">
        <div class="card-head">
          <div><div class="symbol">${s.symbol}</div><div class="name" title="${s.name}">${s.name}</div></div>
          <span class="badge ${s.recommendation}">${s.recommendation}</span>
        </div>
        <div class="price">${fmtMoney(s.price, s.currency)}</div>
        <div class="ytd ${cls(s.ytdPct)}">${sign(s.ytdPct)}${fmtNum(s.ytdPct, '%')} <span class="flat">YTD</span></div>
        <div class="mini-metrics">
          <div><span>Market Cap</span><b>${fmtCap(s.marketCap)}</b></div>
          <div><span>P/E Ratio</span><b>${fmtNum(s.peRatio, 'x')}</b></div>
          <div><span>RSI (14)</span><b>${fmtNum(s.rsi14)}</b></div>
          <div><span>Avg Vol</span><b>${fmtCap(s.avgVolume).replace('$','')}</b></div>
        </div>
        <div class="range">
          <div class="range-line"><i style="width:${pos}%"></i></div>
          <div class="range-labels"><span>${fmtMoney(s.week52Low, s.currency)}</span><span>${fmtMoney(s.week52High, s.currency)}</span></div>
        </div>
      </article>`;
  }).join('');
}

function renderChart(symbols) {
  const labels = symbols[0]?.series?.map(p => p.date) || [];
  const datasets = symbols.map((s, i) => ({
    label: s.symbol,
    data: s.series.map(p => p.value),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    borderWidth: 2,
    pointRadius: 0,
    tension: .24
  }));
  const canvas = $('comparison-chart');
  if (comparisonChart) comparisonChart.destroy();
  comparisonChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#cbd5e1' } } },
      scales: {
        x: { ticks: { color: '#8ea3bd', maxTicksLimit: 6 }, grid: { color: 'rgba(148,163,184,.09)' } },
        y: { ticks: { color: '#8ea3bd' }, grid: { color: 'rgba(148,163,184,.09)' } }
      }
    }
  });
}

function renderSentiment(summary) {
  const score = summary.sentimentScore || 0;
  const ring = $('sentiment-score');
  ring.textContent = '';
  ring.style.setProperty('--score', score);
  ring.dataset.score = score;
  $('sentiment-label').textContent = score >= 65 ? 'BULLISH' : score >= 45 ? 'NEUTRAL / MIXED' : 'BEARISH';
  for (const [id, pct] of [['bull', summary.bullPct], ['neutral', summary.neutralPct], ['bear', summary.bearPct]]) {
    $(`${id}-bar`).style.width = `${pct || 0}%`;
    $(`${id}-pct`).textContent = `${pct || 0}%`;
  }
}

function renderPortfolio(summary) {
  const best = summary.bestPerformer ? `${summary.bestPerformer.symbol} ${sign(summary.bestPerformer.ytdPct)}${summary.bestPerformer.ytdPct}%` : 'N/A';
  const worst = summary.worstPerformer ? `${summary.worstPerformer.symbol} ${summary.worstPerformer.ytdPct}%` : 'N/A';
  $('portfolio-metrics').innerHTML = `
    <div><dt>Combined Mkt Cap</dt><dd>${fmtCap(summary.totalMarketCap)}</dd></div>
    <div><dt>Avg P/E Ratio</dt><dd>${fmtNum(summary.avgPeRatio, 'x')}</dd></div>
    <div><dt>Avg RSI (14)</dt><dd>${fmtNum(summary.avgRsi14)}</dd></div>
    <div><dt>Best Performer</dt><dd class="up">${best}</dd></div>
    <div><dt>Worst Performer</dt><dd class="down">${worst}</dd></div>
    <div><dt>Sentiment Score</dt><dd>${summary.sentimentScore}/100</dd></div>`;
}

function renderAlerts(alerts) {
  $('alert-count').textContent = `${alerts.length} new`;
  $('alerts-list').innerHTML = alerts.length ? alerts.map(a => `
    <div class="alert ${a.severity}"><b>${a.symbol}</b>${a.message}<br><small>${new Date(a.createdAt).toLocaleString()}</small></div>
  `).join('') : '<p class="flat">No active alerts.</p>';
}

async function render() {
  try {
    const data = await loadData();
    renderStatus(data);
    renderTickerStrip(data.symbols);
    renderCards(data.symbols);
    renderChart(data.symbols);
    renderSentiment(data.summary);
    renderPortfolio(data.summary);
    renderAlerts(data.alerts || []);
  } catch (err) {
    $('status-pill').className = 'status-pill stale';
    $('status-pill').textContent = `ERROR · ${err.message}`;
    console.error(err);
  }
}

$('refresh-btn').addEventListener('click', render);
render();
setInterval(render, 60_000);
