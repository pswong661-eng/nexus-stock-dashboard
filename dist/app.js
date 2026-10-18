/* Nanolaos Market Intelligence — app v2 (merged Mission Control × Nexus)
   EOD cadence: data refreshes once per trading day after the US close. */
const DATA_URL = './public/data/latest.json';
const BUBBLE_URL = './public/data/overlays/bubble.json';
const RELOAD_MS = 30 * 60 * 1000; // EOD data — a slow re-check is plenty

const INK = {
  grid: 'rgba(140, 154, 170, .10)', tick: '#8595a8', text: '#e8eef5',
  blue: '#6db2ff', green: '#34d399', gold: '#e8c468', red: '#f87171', purple: '#b48cff'
};

const state = { data: null, bubble: null, sort: { key: 'score', dir: -1 }, filter: '', drawer: null, tab: 'quote', charts: {} };

/* ── formatting ─────────────────────────────────────── */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const pctCls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
const sign = (v, d = 2) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const money = v => v == null || !Number.isFinite(v) ? '—' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toFixed(2)}`;
const price = v => v == null || !Number.isFinite(v) ? '—' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
const num = (v, d = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const dash = v => v == null || v === '' ? '—' : v;

const TREND = {
  '🟢 >both': { t: '▲▲', c: 'up' }, '🟡 >50 <200': { t: '▲', c: 'mid-up' },
  '🟡 <50 >200': { t: '▼', c: 'mid-dn' }, '🔴 <both': { t: '▼▼', c: 'dn' }
};
const LYNCH_CLS = { PASS: 'bull', BORDERLINE: 'warn', MIXED: 'warn', FAIL: 'bear' };
const LYNCH_ORDER = ['PASS', 'BORDERLINE', 'MIXED', 'SPECIAL SITUATION', 'SPECIAL', 'ASSET PLAY', 'CYCLICAL', 'N/M', 'FAIL'];
const BIAS_CLS = { BULLISH: 'bull', BEARISH: 'bear', OVERBOUGHT: 'bear', OVERSOLD: 'bull' };

function fmtSources(s) {
  const d = s?.dataSources;
  if (!d) return 'Massive';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.join(' · ');
  // per-dataset source map: { price: 'Massive', financials: 'SEC', ... }
  return Object.entries(d).filter(([, v]) => v && v !== 'none').map(([k, v]) => `${k}: ${v}`).join(' · ');
}
const svNorm = r => (r == null || !Number.isFinite(r)) ? null : (r > 1.5 ? r / 100 : r);
const shortVolRatio = s => svNorm(s?.shortVolume?.latest?.shortVolumeRatio ?? s?.shortVolume?.avgShortVolumeRatio20);

/* ── data load ──────────────────────────────────────── */
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok && r.status !== 404) throw new Error(`${url} → HTTP ${r.status}`);
  return r.status === 404 ? null : r.json();
}

async function load({ manual = false } = {}) {
  const btn = $('#btn-refresh');
  if (manual && btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = '⟳ Refreshing…'; }
  const prevGeneratedAt = state.data?.generatedAt;
  try {
    const [data, bubble] = await Promise.all([fetchJson(DATA_URL), fetchJson(BUBBLE_URL).catch(() => null)]);
    if (!data || !Array.isArray(data.symbols) || !data.symbols.length) throw new Error('No symbols in payload');
    state.data = data; state.bubble = bubble;
    $('#error-banner').hidden = true;
    renderAll();
    if (manual) {
      const flash = $('#refresh-flash');
      const changed = prevGeneratedAt !== data.generatedAt;
      if (flash) {
        flash.textContent = changed
          ? `✓ Data updated — session ${sessionDate(data)}`
          : `• Snapshot current — session ${sessionDate(data)} (EOD, next refresh 05:00 ICT after next close)`;
        flash.className = 'refresh-flash show ' + (changed ? 'ok' : 'same');
        clearTimeout(flash._t); flash._t = setTimeout(() => flash.classList.remove('show'), 6000);
      }
    }
  } catch (e) {
    const b = $('#error-banner'); if (b) { b.hidden = false;
    b.textContent = `Data load failed: ${e.message}. ${state.data ? '(Previous snapshot remains rendered.)' : 'Retry with Refresh.'}`; }
  } finally {
    if (manual && btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = '↻ Refresh'; }
    const ra = $('#refreshed-at'); if (ra) ra.textContent = `checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

/* ── render orchestration ───────────────────────────── */
function renderAll() {
  renderHeader(); renderStats(); renderTable(); renderSector(); renderShortVol();
  renderLynch(); renderBubble(); renderAlerts();
  if (state.drawer) openDrawer(state.drawer, { keepTab: true });
}

function sessionDate(data) {
  for (const s of data.symbols) {
    const t = s.technical || []; if (t.length) return t[t.length - 1].date;
  }
  return data.generatedAt?.slice(0, 10) ?? '—';
}

function renderHeader() {
  const d = state.data;
  $('#session-date').textContent = `session ${sessionDate(d)}`;
  $('#refreshed-at').textContent = `updated ${new Date(d.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  const st = $('#data-status');
  if (d.dataStatus === 'partial') {
    st.hidden = false;
    const detail = (d.errors || []).map(e => typeof e === 'string' ? e : `${e.symbol}: ${e.error}`).join(' · ')
      || 'some symbols lag the latest session';
    st.textContent = 'PARTIAL DATA';
    st.title = detail;
  } else if (d.dataStatus === 'fallback') { st.hidden = false; st.textContent = 'FALLBACK DATA'; st.title = 'serving last known good snapshot'; }
  else st.hidden = true;
  $('#foot-meta').textContent = `${d.symbols.length} tickers · src ${d.source} · overlays ${d.overlayRefreshedAt ? new Date(d.overlayRefreshedAt).toLocaleDateString() : '—'}`;
}

/* ── stat cards ─────────────────────────────────────── */
function renderStats() {
  const d = state.data, syms = d.symbols;
  const rsiVals = syms.map(s => s.rsi ?? s.rsi14).filter(Number.isFinite);
  const avgRsi = rsiVals.reduce((a, b) => a + b, 0) / (rsiVals.length || 1);
  const biasCount = k => syms.filter(s => Array.isArray(k) ? k.includes(s.bias) : s.bias === k).length;
  const bullN = biasCount('BULLISH'), bearN = biasCount(['BEARISH', 'OVERBOUGHT']);
  const neutralN = syms.length - bullN - bearN;
  const pctOf = n => Math.round(n / (syms.length || 1) * 100);
  const best = [...syms].sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9))[0];
  const worst = [...syms].sort((a, b) => (a.changePct ?? 1e9) - (b.changePct ?? 1e9))[0];
  const hiShort = [...syms].sort((a, b) => (shortVolRatio(b) ?? -1) - (shortVolRatio(a) ?? -1))[0];
  const cards = [
    { k: 'Universe', v: `${syms.length}`, s: 'EOD coverage', cls: '' },
    { k: 'Avg RSI-14', v: avgRsi.toFixed(1), s: 'watchlist mean', cls: avgRsi > 60 ? 'up' : avgRsi < 40 ? 'down' : '' },
    { k: 'Bias Split', v: `${pctOf(bullN)}%`, s: `bull ${bullN} · bear ${bearN} · neutral ${neutralN}`, cls: bullN >= bearN ? 'up' : 'down' },
    { k: 'Best Δ Day', v: best ? `${best.symbol} ${sign(best.changePct, 1)}` : '—', s: best?.name ?? '', cls: 'up' },
    { k: 'Worst Δ Day', v: worst ? `${worst.symbol} ${sign(worst.changePct, 1)}` : '—', s: worst?.name ?? '', cls: 'down' },
    { k: 'Heaviest Short', v: hiShort ? `${(shortVolRatio(hiShort) * 100).toFixed(0)}%` : '—', s: hiShort ? `${hiShort.symbol} FINRA ratio` : '', cls: '' }
  ];
  const host = $('#stats'); host.innerHTML = '';
  for (const c of cards) {
    const n = el('div', 'stat');
    n.append(el('span', 'k', c.k), el('span', `v ${c.cls}`, c.v), el('span', 's', c.s));
    host.append(n);
  }
}

/* ── watchlist table ────────────────────────────────── */
function sortVal(s, key) {
  switch (key) {
    case 'shortVol': return shortVolRatio(s) ?? -1;
    case 'lynch': return LYNCH_ORDER.indexOf((s.lynch?.verdict || 'N/M').toUpperCase());
    case 'signal': return { '🟢 >both': 4, '🟡 >50 <200': 3, '🟡 <50 >200': 2, '🔴 <both': 1 }[s.signal] ?? 0;
    case 'price': return s.price ?? -1e9;
    default: return s[key];
  }
}
function visible() {
  const f = state.filter.trim().toLowerCase();
  const rows = state.data.symbols.filter(s => !f ||
    s.symbol.toLowerCase().includes(f) || (s.name || '').toLowerCase().includes(f) ||
    (s.sector || '').toLowerCase().includes(f));
  const { key, dir } = state.sort;
  return rows.sort((a, b) => {
    const va = sortVal(a, key), vb = sortVal(b, key);
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir;
    return ((va ?? -1e9) - (vb ?? -1e9)) * dir || a.symbol.localeCompare(b.symbol);
  });
}

function rsiCell(v) {
  if (v == null || !Number.isFinite(v)) return '<span class="muted">—</span>';
  const cls = v > 70 ? 'chip bear' : v < 30 ? 'chip bull' : 'chip flat';
  return `<span class="rsi-cell ${cls}">${v.toFixed(0)}</span>`;
}
function bar52(v) {
  if (v == null || !Number.isFinite(v)) return '<span class="muted">—</span>';
  const p = Math.max(0, Math.min(100, v));
  return `<span class="rangebar"><span style="width:${p}%"></span><b style="left:${p}%"></b></span><span class="mono small">${p.toFixed(0)}%</span>`;
}
function scoreDots(sc) {
  if (sc == null) return '<span class="muted">—</span>';
  return `<span class="dots s${sc}">${[0, 1, 2, 3].map(i => `<i class="${i < sc ? 'on' : ''}"></i>`).join('')}</span>`;
}
function lynchCell(s) {
  const l = s.lynch; if (!l) return '<span class="muted">—</span>';
  const v = (l.verdict || 'N/M').toUpperCase();
  const cls = LYNCH_CLS[v] || 'flat';
  const peg = Number.isFinite(l.pegy) ? `PEGY ${Number(l.pegy).toFixed(1)}` : (l.category || '');
  return `<span class="lynch-chip" title="${(l.note || '').replace(/"/g, '&quot;')}"><span class="chip ${cls}">${v}</span><span class="peg muted">${peg}</span></span>`;
}

function renderTable() {
  const rows = visible(), body = $('#watch-body');
  body.innerHTML = '';
  for (const s of rows) {
    const tr = el('tr'); tr.dataset.sym = s.symbol; tr.tabIndex = 0;
    tr.title = `${s.name || s.symbol}${s.sector ? ' · ' + s.sector : ''}${s.macdStatus ? ' · MACD ' + s.macdStatus : ''}${s.support != null ? ` · S/R ${num(s.support, 1)}/${num(s.resistance, 1)}` : ''}`;
    const t = TREND[s.signal] || { t: '·', c: '' };
    const sv = shortVolRatio(s);
    const macdCls = /bull/.test(s.macdStatus) ? 'pos' : /bear/.test(s.macdStatus) ? 'neg' : 'flat';
    tr.innerHTML = `
      <td class="col-sym"><span class="sym">${s.symbol}</span></td>
      <td class="col-name tname" title="${(s.name || '').replace(/"/g, '&quot;')}">${dash(s.name)}</td>
      <td class="col-sector sector-cell">${dash(s.sector)}</td>
      <td class="num mono">${price(s.price)}</td>
      <td class="num mono ${pctCls(s.changePct)}">${sign(s.changePct)}</td>
      <td class="num mono ${pctCls(s.ytdPct)}">${sign(s.ytdPct, 1)}</td>
      <td><span class="trend ${t.c}">${t.t}</span></td>
      <td class="num">${scoreDots(s.score)}</td>
      <td><span class="chip ${BIAS_CLS[s.bias] || 'flat'}">${dash(s.bias)}</span></td>
      <td class="num">${rsiCell(s.rsi ?? s.rsi14)}</td>
      <td class="col-macd"><span class="${macdCls} small">${dash(s.macdStatus)}</span></td>
      <td class="num">${bar52(s.pos52w)}</td>
      <td class="num mono muted col-sr">${num(s.support, 1)} / ${num(s.resistance, 1)}</td>
      <td class="num mono ${s.volRatio > 1.5 ? 'pos' : ''}">${num(s.volRatio, 1)}×</td>
      <td class="num mono">${sv != null ? (sv * 100).toFixed(0) + '%' : '—'}</td>
      <td class="num mono">${s.peRatio != null ? s.peRatio.toFixed(1) : s.lynch?.peTtm != null ? Number(s.lynch.peTtm).toFixed(1) : '—'}</td>
      <td>${lynchCell(s)}</td>`;
    tr.addEventListener('click', () => openDrawer(s.symbol));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openDrawer(s.symbol); });
    body.append(tr);
  }
  $('#wl-count').textContent = `· ${rows.length}`;
  const sr = rows.filter(r => r.support != null).length;
  $('#wl-foot').textContent = `EOD snapshot · ${rows.length} names · ${sr} with S/R bands · score = SMA50+SMA200+MACD+RSI filters (0–4) · PEGY from internal screen overlay`;
  document.querySelectorAll('#watch-table th.sortable').forEach(th => {
    th.classList.toggle('sorted-asc', th.dataset.key === state.sort.key && state.sort.dir === 1);
    th.classList.toggle('sorted-desc', th.dataset.key === state.sort.key && state.sort.dir === -1);
    th.onclick = () => {
      const k = th.dataset.key;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (['symbol', 'name', 'sector', 'macdStatus', 'bias', 'signal', 'lynch'].includes(k) ? 1 : -1) };
      renderTable();
    };
  });
}

/* ── sector + short volume panels ───────────────────── */
function renderSector() {
  const groups = {};
  for (const s of state.data.symbols) {
    const k = s.sector || 'Other';
    (groups[k] ??= []).push(s.changePct ?? 0);
  }
  const rows = Object.entries(groups)
    .map(([k, vs]) => ({ k, n: vs.length, avg: vs.reduce((a, b) => a + b, 0) / vs.length }))
    .sort((a, b) => b.avg - a.avg);
  const max = Math.max(1e-9, ...rows.map(r => Math.abs(r.avg)));
  const host = $('#sector-list'); host.innerHTML = '';
  for (const r of rows) {
    const w = Math.abs(r.avg) / max * 50;
    const n = el('div', 'vrow');
    n.innerHTML = `<span class="lab">${r.k}<span class="sub">${r.n}</span></span>
      <span class="hbar">${r.avg < 0 ? `<span class="l" style="width:${w}%"></span>` : `<span class="r" style="width:${w}%"></span>`}</span>
      <span class="val ${pctCls(r.avg)}">${sign(r.avg, 2)}</span>`;
    host.append(n);
  }
}
function renderShortVol() {
  const rows = state.data.symbols
    .map(s => ({ s, r: shortVolRatio(s) }))
    .filter(x => x.r != null)
    .sort((a, b) => b.r - a.r).slice(0, 10);
  const host = $('#shortvol-list'); host.innerHTML = '';
  for (const { s, r } of rows) {
    const tag = r > 0.65 ? 'chip bear' : r > 0.55 ? 'chip warn' : 'chip flat';
    const avg = svNorm(s.shortVolume?.avgShortVolumeRatio20);
    const n = el('div', 'vrow');
    n.innerHTML = `<span class="lab">${s.symbol}<span class="sub">${s.name || ''}</span></span>
      <span class="hbar"><span class="r" style="width:${Math.min(100, r * 100)}%; background:${r > 0.65 ? 'var(--down)' : r > 0.55 ? 'var(--warn)' : 'var(--accent)'}"></span></span>
      <span class="val"><span class="${tag}" style="margin-left:6px">${(r * 100).toFixed(0)}%</span>${avg != null ? `<span class="muted small"> a20 ${(avg * 100).toFixed(0)}%</span>` : ''}</span>`;
    host.append(n);
  }
}

/* ── lynch screen ───────────────────────────────────── */
function renderLynch() {
  const host = $('#lynch-groups'); host.innerHTML = '';
  const groups = {};
  for (const s of state.data.symbols) {
    const v = (s.lynch?.verdict || 'N/M').toUpperCase();
    (groups[v] ??= []).push(s);
  }
  const order = [...LYNCH_ORDER.filter(k => groups[k]), ...Object.keys(groups).filter(k => !LYNCH_ORDER.includes(k))];
  for (const v of order) {
    const g = el('div', 'lg');
    const head = el('div', 'lg-head');
    head.innerHTML = `<h3>${v}</h3><span class="chip ${LYNCH_CLS[v] || 'flat'}">${groups[v].length}</span>`;
    const row = el('div', 'lg-row');
    for (const s of groups[v].sort((a, b) => (b.lynch?.pegy ?? -1) - (a.lynch?.pegy ?? -1))) {
      const l = s.lynch || {};
      const it = el('span', 'lg-item');
      it.title = `${s.symbol} — ${l.note || 'no note'}${l.screenedAt ? ` (screened ${String(l.screenedAt).slice(0, 10)})` : ''}`;
      it.innerHTML = `<span class="s">${s.symbol}</span><span class="c">${dash(l.category)}</span>${Number.isFinite(l.pegy) ? `<span class="chip flat mono">PEGY ${Number(l.pegy).toFixed(1)}</span>` : ''}`;
      it.addEventListener('click', () => openDrawer(s.symbol));
      row.append(it);
    }
    g.append(head, row); host.append(g);
  }
}

/* ── bubble panel ───────────────────────────────────── */
function renderBubble() {
  const b = state.bubble, host = $('#bubble-body');
  if (!b?.latest) {
    $('#bubble-card').style.display = 'none'; return;
  }
  $('#bubble-card').style.display = '';
  $('#bubble-date').textContent = b.latest.date ? `week of ${b.latest.date}` : '';
  const cls = b.latest.score >= 60 ? 'down' : b.latest.score >= 35 ? '' : 'up';
  const top = el('div', 'bub-top');
  const wow = Number.isFinite(b.wow_delta) ? `${b.wow_delta > 0 ? '+' : ''}${b.wow_delta} WoW pts` : '';
  top.innerHTML = `<span class="bub-score ${cls}">${b.latest.score}</span>
    <div class="bub-meta"><div><span class="chip ${b.latest.score >= 60 ? 'bear' : b.latest.score >= 35 ? 'warn' : 'bull'}">${b.latest.label}</span>
    <span class="muted small" style="margin-left:8px">${wow}</span></div>
    <div class="muted small" style="margin-top:4px">0–100 composite · higher = more fragile</div></div>`;
  const comp = el('div', 'bub-comp');
  for (const c of b.latest.components || []) {
    const p = Math.round((c.pts / (c.max || 1)) * 100);
    const col = p >= 66 ? 'var(--down)' : p >= 33 ? 'var(--warn)' : 'var(--up)';
    comp.insertAdjacentHTML('beforeend',
      `<div class="bub-row"><span class="nm">${c.name}<span class="blk">${c.block}</span></span>
       <span class="hbar"><span style="width:${p}%; left:0; background:${col}; border-radius:4px; position:absolute; top:0; bottom:0;"></span></span>
       <span class="val mono muted" style="text-align:right">${c.pts}/${c.max}</span></div>`);
  }
  host.innerHTML = ''; host.append(top, comp);
}

/* ── alerts ─────────────────────────────────────────── */
function renderAlerts() {
  const host = $('#alerts-list'); host.innerHTML = '';
  const alerts = state.data.alerts || [];
  if (!alerts.length) { host.append(el('li', '', '<span class="muted">No unusual activity flagged this session.</span>')); return; }
  for (const a of alerts.slice(0, 24)) {
    const li = el('li');
    if (typeof a === 'string') { li.textContent = a; }
    else {
      const sym = a.symbol ? `<b class="mono">${a.symbol}</b> · ` : '';
      const msg = a.message || a.reason || a.note || a.title || a.kind || JSON.stringify(a).slice(0, 140);
      li.innerHTML = `${sym}${String(msg).replace(/</g, '&lt;')}`;
    }
    host.append(li);
  }
}

/* ── drawer ─────────────────────────────────────────── */
function openDrawer(sym, { keepTab = false } = {}) {
  const s = state.data.symbols.find(x => x.symbol === sym);
  if (!s) return;
  state.drawer = sym;
  if (!keepTab) state.tab = 'quote';
  $('#drawer').hidden = false;
  $('#dw-sym').textContent = `${s.symbol} · ${price(s.price)}`;
  $('#dw-sub').textContent = `${s.name || ''} ${s.sector ? `· ${s.sector}` : ''} · ${s.exchange || ''}`.trim();
  document.querySelectorAll('#dw-tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === state.tab);
    b.onclick = () => { state.tab = b.dataset.tab; openDrawer(sym, { keepTab: true }); };
  });
  const show = t => { for (const k of ['quote', 'technical', 'financials', 'insider']) $(`#dw-${k}`).hidden = k !== t; };
  show(state.tab);
  if (state.tab === 'quote') renderQuote(s);
  if (state.tab === 'technical') renderCharts(s);
  if (state.tab === 'financials') renderFinancials(s);
  if (state.tab === 'insider') renderInsider(s);
}
function closeDrawer() {
  state.drawer = null; $('#drawer').hidden = true;
  for (const c of Object.values(state.charts)) c?.destroy?.();
  state.charts = {};
}
function row(k, v, cls = '') { return `<div class="row"><span class="muted">${k}</span><b class="${cls}">${v}</b></div>`; }

function renderQuote(s) {
  const l = s.lynch, sv = shortVolRatio(s);
  $('#dw-quote').innerHTML = `<div class="kv">
    ${row('Last', `$${price(s.price)}`)}
    ${row('Δ Day', sign(s.changePct), pctCls(s.changePct))}
    ${row('YTD', sign(s.ytdPct, 1), pctCls(s.ytdPct))}
    ${row('52w Range', `${price(s.week52Low ?? s.low52)} – ${price(s.week52High ?? s.high52)}`)}
    ${row('52w Position', s.pos52w != null ? `${s.pos52w.toFixed(0)}%` : '—')}
    ${row('SMA50 / SMA200', `${num(s.sma50, 1)} / ${num(s.sma200, 1)}`)}
    ${row('EMA50', num(s.ema50, 2))}
    ${row('RSI-14', num(s.rsi ?? s.rsi14, 1))}
    ${row('MACD', `${dash(s.macdStatus)} · ${num(s.macdDiff, 3)}`)}
    ${row('Support / Resistance', `${num(s.support, 1)} / ${num(s.resistance, 1)}`)}
    ${row('Volume vs avg20', s.volRatio != null ? `${s.volRatio.toFixed(1)}×` : '—')}
    ${row('Short vol ratio', sv != null ? `${(sv * 100).toFixed(1)}% (a20 ${svNorm(s.shortVolume?.avgShortVolumeRatio20) != null ? (svNorm(s.shortVolume.avgShortVolumeRatio20) * 100).toFixed(0) + '%' : '—'})` : '—')}
    ${row('Market cap', money(s.marketCap))}
    ${row('P/E', s.peRatio != null ? s.peRatio.toFixed(1) : l?.peTtm != null ? Number(l.peTtm).toFixed(1) + ' (screen)' : '—')}
    ${row('Score', `${s.score ?? '—'} / 4`)}
    ${row('Bias', dash(s.bias))}
    ${l ? row('Lynch', `${dash(l.verdict)} · PEGY ${num(l.pegy, 1)} · ${dash(l.category)}`) : row('Lynch', '—')}
    ${row('Sources', fmtSources(s))}
  </div>
  ${l?.note ? `<p class="muted small" style="margin-top:10px">Lynch note: ${l.note}</p>` : ''}`;
}

function chartBase(extra = {}) {
  return {
    animation: false, responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: INK.tick, boxWidth: 10, font: { size: 10, family: 'IBM Plex Mono' } } } },
    scales: {
      x: { ticks: { color: INK.tick, maxTicksLimit: 7, font: { size: 9, family: 'IBM Plex Mono' } }, grid: { color: 'transparent' } },
      y: { ticks: { color: INK.tick, font: { size: 9, family: 'IBM Plex Mono' } }, grid: { color: INK.grid } },
      ...extra
    }
  };
}
function renderCharts(s) {
  if (!window.Chart) return;
  const t = (s.technical || []).slice(-120);
  const labels = t.map(p => p.date?.slice(5));
  const mk = (id) => { state.charts[id]?.destroy?.(); return $(id); };
  state.charts.p = new Chart(mk('#ch-price'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Close', data: t.map(p => p.close), borderColor: INK.blue, borderWidth: 1.4, pointRadius: 0, tension: .25 },
      { label: 'EMA50', data: t.map(p => p.ema50), borderColor: INK.gold, borderWidth: 1, pointRadius: 0, borderDash: [4, 3], tension: .25 }
    ] },
    options: chartBase()
  });
  state.charts.m = new Chart(mk('#ch-macd'), {
    data: { labels, datasets: [
      { type: 'bar', label: 'Hist', data: t.map(p => p.macdHist), backgroundColor: t.map(p => p.macdHist >= 0 ? 'rgba(52,211,153,.45)' : 'rgba(248,113,113,.45)') },
      { type: 'line', label: 'MACD', data: t.map(p => p.macd), borderColor: INK.blue, borderWidth: 1.2, pointRadius: 0 },
      { type: 'line', label: 'Signal', data: t.map(p => p.macdSignal), borderColor: INK.gold, borderWidth: 1, pointRadius: 0, borderDash: [4, 3] }
    ] },
    options: chartBase()
  });
  state.charts.r = new Chart(mk('#ch-rsi'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'RSI-14', data: t.map(p => p.rsi14), borderColor: INK.purple, borderWidth: 1.2, pointRadius: 0, tension: .25 }] },
    options: chartBase({ y: { min: 0, max: 100, ticks: { color: INK.tick, stepSize: 25, font: { size: 9, family: 'IBM Plex Mono' } }, grid: { color: INK.grid } } })
  });
}

function renderFinancials(s) {
  const q = s.financials?.quarters || [];
  if (!q.length) { $('#dw-financials').innerHTML = '<p class="muted">No financial data available.</p>'; return; }
  const rows = q.slice(0, 8).map(r => `<tr>
    <td>${r.period}</td><td>${money(r.revenue)}</td><td>${money(r.netIncome)}</td>
    <td class="${pctCls(r.netIncome / r.revenue)}">${r.revenue ? (r.netIncome / r.revenue * 100).toFixed(1) + '%' : '—'}</td>
    <td>${money(r.equity)}</td><td>${money(r.assets)}</td><td class="muted">${r.source || ''}</td></tr>`).join('');
  $('#dw-financials').innerHTML = `
    <table class="mini"><thead><tr><th>Period</th><th>Revenue</th><th>Net Inc</th><th>Margin</th><th>Equity</th><th>Assets</th><th>Src</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small" style="margin-top:8px">SEC EDGAR company facts + Yahoo quarterlies (fallback). ${s.financials?.note || ''}</p>`;
}

/* SEC Form 4 transaction codes — color by signal quality. */
const TX_CODES = {
  P: { label: 'Buy', cls: 'bull', hint: 'Open-market purchase (discretionary buy)' },
  S: { label: 'Sell', cls: 'bear', hint: 'Open-market sale (discretionary sell)' },
  M: { label: 'Exercise', cls: 'warn', hint: 'Option exercise / derivative converted to shares' },
  F: { label: 'Tax w/h', cls: 'flat', hint: 'Shares withheld to cover exercise price or taxes' },
  A: { label: 'Award', cls: 'info', hint: 'Grant/award of securities (RSUs, options)' },
  G: { label: 'Gift', cls: 'flat', hint: 'Bona fide gift' },
  D: { label: 'To issuer', cls: 'flat', hint: 'Disposition back to the issuer' },
  U: { label: '10b5-1', cls: 'flat', hint: 'Discretionary trade under a 10b5-1 plan' },
  I: { label: 'Discret.', cls: 'flat', hint: 'Discretionary transaction (not open-market)' }
};

function renderInsider(s) {
  const ins = s.insider || [];
  if (!ins.length) { $('#dw-insider').innerHTML = '<p class="muted">No insider filings found.</p>'; return; }
  $('#dw-insider').innerHTML = ins.slice(0, 10).map(f => {
    const seen = new Set();
    const txs = (f.transactions || [])
      .filter(t => { // skip empty holdings rows (no code and no shares)
        if (!t.code && t.shares == null) return false;
        return true;
      })
      .filter(t => { // 4/A amendments restate the original transactions — dedupe
        const k = [t.date, t.code, t.shares, t.price].join('|');
        if (seen.has(k)) return false; seen.add(k); return true;
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(t => {
        const meta = TX_CODES[t.code] || { label: t.code || '—', cls: 'flat', hint: `Form 4 code ${t.code}` };
        const val = Number.isFinite(t.shares) && Number.isFinite(t.price) && t.price > 0 ? t.shares * t.price : null;
        return `<tr>
          <td class="mono">${t.date || '—'}</td>
          <td><span class="chip ${meta.cls}" title="${meta.hint}">${t.code || '—'}</span></td>
          <td class="muted small">${meta.label}</td>
          <td class="mono num">${t.shares != null ? Number(t.shares).toLocaleString() : '—'}</td>
          <td class="mono num">${t.price != null ? '$' + Number(t.price).toFixed(2) : '—'}</td>
          <td class="mono num">${val != null ? '$' + Math.round(val).toLocaleString() : '—'}</td></tr>`;
      }).join('');
    return `<div class="ins-row">
      <div class="hd"><span>${f.owner || '—'} · ${f.title || ''}</span><span>${f.form} · filed ${f.filingDate || '?'}</span></div>
      <table class="mini ins-tbl">
        <thead><tr><th>Date</th><th>Code</th><th>Action</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th></tr></thead>
        <tbody>${txs}</tbody>
      </table>
    </div>`;
  }).join('') + `<p class="muted small">SEC Form 4 via Massive — latest 10 filings · codes: <b>P</b> open-market buy · <b>S</b> open-market sell · <b>M</b> option exercise · <b>F</b> tax withholding · <b>A</b> award · <b>G</b> gift. F/M are mechanical (not discretionary) — read P/S as the signal.</p>`;
}

/* ── wiring ─────────────────────────────────────────── */
// Null-safe binder: a stale cached index.html (older shell + newer JS) must
// never kill the boot script — one missing element would abort everything
// below it, leaving empty panels until a manual re-render.
const on = (sel, ev, fn) => { const n = $(sel); if (n) n.addEventListener(ev, fn); };

const savedView = localStorage.getItem('wl-view');
const initView = savedView === 'full' || savedView === 'fit' ? savedView : (window.innerWidth < 1280 ? 'fit' : 'fit');
function setView(v) {
  document.body.classList.toggle('view-fit', v === 'fit');
  document.querySelectorAll('#view-toggle button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  localStorage.setItem('wl-view', v);
}
document.querySelectorAll('#view-toggle button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
setView(initView);

on('#btn-refresh', 'click', () => load({ manual: true }));
on('#wl-filter', 'input', e => { state.filter = e.target.value; renderTable(); });
on('#drawer', 'click', e => { if (e.target.closest('[data-close]')) closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
window.addEventListener('hashchange', () => {
  const sym = location.hash.replace(/^#\/?/, '').toUpperCase();
  if (sym && state.data?.symbols.some(s => s.symbol === sym)) openDrawer(sym);
});

load().then(() => {
  const sym = location.hash.replace(/^#\/?/, '').toUpperCase();
  if (sym && state.data?.symbols.some(s => s.symbol === sym)) openDrawer(sym);
});
setInterval(load, RELOAD_MS);
