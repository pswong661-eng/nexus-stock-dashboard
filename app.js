const DATA_URL = './public/data/latest.json';
const colors = ['#28e6a3', '#59b4ff', '#a78bfa', '#ffd166', '#ff647c', '#38bdf8', '#f472b6', '#84cc16'];
let comparisonChart, emaChart, macdChart, rsiChart, financialChart, latestData;
const $ = id => document.getElementById(id);
const fmtMoney = (n, currency = 'USD') => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n) : 'N/A';
const fmtCap = n => !Number.isFinite(n) ? 'N/A' : n >= 1e12 ? `$${(n/1e12).toFixed(1)}T` : n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
const fmtNum = (n, suffix = '') => Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : 'N/A';
const cls = n => Number.isFinite(n) ? n > 0 ? 'up' : n < 0 ? 'down' : 'flat' : 'flat';
const sign = n => Number.isFinite(n) && n > 0 ? '+' : '';
const usd0 = n => Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : 'N/A';
const fmtPct = n => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'N/A';
const fmtRatioPct = n => Number.isFinite(n) ? `${n.toFixed(1)}%` : 'N/A';
const refreshBtn = $('refresh-btn');
function updateClock(){ $('clock').textContent = new Date().toLocaleTimeString(); } setInterval(updateClock,1000); updateClock();
async function loadData(){ const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache:'no-store' }); if(!res.ok) throw new Error(`Data fetch failed: ${res.status}`); return res.json(); }
function renderStatus(data){ const g=new Date(data.generatedAt); const age=(Date.now()-g.getTime())/60000; const stale=age>(data.staleAfterMinutes||1440); const pill=$('status-pill'); pill.className=`status-pill ${stale?'stale':'live'}`; pill.textContent=`${stale?'STALE':'LIVE'} · ${data.dataStatus.toUpperCase()} · ${g.toLocaleString()}`; }
function renderTickerStrip(symbols){ $('ticker-strip').innerHTML=symbols.map(s=>`<div class="ticker-chip"><b>${s.symbol}</b><span>${fmtMoney(s.price,s.currency)}</span><br><small class="${cls(s.ytdPct)}">${sign(s.ytdPct)}${fmtNum(s.ytdPct,'%')} YTD</small></div>`).join(''); }
function renderCards(symbols){ $('stock-cards').innerHTML=symbols.map(s=>{ const pos=([s.price,s.week52Low,s.week52High].every(Number.isFinite)&&s.week52High>s.week52Low)?Math.max(0,Math.min(100,((s.price-s.week52Low)/(s.week52High-s.week52Low))*100)):0; const short=s.shortVolume?.latest||{}; const unusual=s.unusualActivity||{}; return `<article class="stock-card"><div class="card-head"><div><div class="symbol">${s.symbol}</div><div class="name" title="${s.name}">${s.name}</div></div><span class="badge ${s.recommendation}">${s.recommendation}</span></div><div class="price">${fmtMoney(s.price,s.currency)}</div><div class="ytd ${cls(s.ytdPct)}">${sign(s.ytdPct)}${fmtNum(s.ytdPct,'%')} <span class="flat">YTD</span></div><div class="mini-metrics"><div><span>Short Vol</span><b>${fmtCap(short.shortVolume).replace('$','')}</b></div><div><span>Short Ratio</span><b>${fmtRatioPct(short.shortVolumeRatio)}</b></div><div><span>Vol Spike</span><b>${Number.isFinite(unusual.volumeMultiple)?`${unusual.volumeMultiple.toFixed(1)}x`:'N/A'}</b></div><div><span>Signals</span><b>${unusual.signals?.length||0}</b></div></div><div class="range"><div class="range-line"><i style="width:${pos}%"></i></div><div class="range-labels"><span>${fmtMoney(s.week52Low,s.currency)}</span><span>${fmtMoney(s.week52High,s.currency)}</span></div></div></article>`; }).join(''); }
function makeLineChart(canvas, datasets, labels, extra={}){ return new Chart(canvas,{type:'line',data:{labels,datasets},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#cbd5e1'}}},scales:{x:{ticks:{color:'#8ea3bd',maxTicksLimit:7},grid:{color:'rgba(148,163,184,.09)'}},y:{ticks:{color:'#8ea3bd'},grid:{color:'rgba(148,163,184,.09)'},...extra.y}}}}); }
function renderComparison(symbols){ const labels=symbols[0]?.series?.map(p=>p.date)||[]; const datasets=symbols.map((s,i)=>({label:s.symbol,data:s.series.map(p=>p.value),borderColor:colors[i%colors.length],backgroundColor:colors[i%colors.length],borderWidth:2,pointRadius:0,tension:.24})); if(comparisonChart) comparisonChart.destroy(); comparisonChart=makeLineChart($('comparison-chart'),datasets,labels); }
function fillSelect(id,symbols){ const sel=$(id); const cur=sel.value || symbols[0]?.symbol; sel.innerHTML=symbols.map(s=>`<option value="${s.symbol}">${s.symbol} — ${s.name}</option>`).join(''); if(symbols.some(s=>s.symbol===cur)) sel.value=cur; }
function selected(id){ return latestData.symbols.find(s=>s.symbol===$(id).value) || latestData.symbols[0]; }
function renderTechnical(){ const s=selected('technical-symbol'); if(!s) return; const t=s.technical||[]; const labels=t.map(p=>p.date); if(emaChart) emaChart.destroy(); if(macdChart) macdChart.destroy(); if(rsiChart) rsiChart.destroy(); emaChart=makeLineChart($('ema-chart'),[{label:`${s.symbol} Close`,data:t.map(p=>p.close),borderColor:'#59b4ff',pointRadius:0,tension:.2},{label:'EMA50',data:t.map(p=>p.ema50),borderColor:'#28e6a3',pointRadius:0,tension:.2}],labels); macdChart=makeLineChart($('macd-chart'),[{label:'MACD',data:t.map(p=>p.macd),borderColor:'#a78bfa',pointRadius:0,tension:.2},{label:'Signal',data:t.map(p=>p.macdSignal),borderColor:'#ffd166',pointRadius:0,tension:.2},{label:'Histogram',data:t.map(p=>p.macdHist),borderColor:'#ff647c',backgroundColor:'rgba(255,100,124,.18)',pointRadius:0,tension:.2}],labels); rsiChart=makeLineChart($('rsi-chart'),[{label:'RSI(14)',data:t.map(p=>p.rsi14),borderColor:'#28e6a3',pointRadius:0,tension:.2},{label:'Overbought 70',data:t.map(()=>70),borderColor:'#ff647c',borderDash:[6,6],pointRadius:0},{label:'Oversold 30',data:t.map(()=>30),borderColor:'#59b4ff',borderDash:[6,6],pointRadius:0}],labels,{y:{min:0,max:100}}); }
function renderCompanyProfile(s){ const c=s.company||{}; const source=s.dataSources?.profile||'none'; $('company-profile').innerHTML=`<div><p class="eyebrow">Company profile</p><h3>${s.name}</h3><p>${c.description||'Company profile will appear after the next Massive.com refresh.'}</p></div><dl class="profile-metrics"><div><dt>Industry</dt><dd>${c.industry||'N/A'}</dd></div><div><dt>Market Cap</dt><dd>${fmtCap(s.marketCap)}</dd></div><div><dt>Employees</dt><dd>${fmtNum(c.employees)}</dd></div><div><dt>Source</dt><dd>${source}</dd></div></dl>`; }
function renderRatios(s){ const r=s.ratios||{}; const rows=[['P/E',fmtNum(r.pe)],['P/S',fmtNum(r.ps)],['EV/EBITDA',fmtNum(r.evToEbitda)],['ROE',fmtPct(r.roe)],['Debt/Equity',fmtNum(r.debtToEquity)],['Current',fmtNum(r.currentRatio)],['FCF',fmtCap(r.freeCashFlow)],['Dividend Yield',fmtPct(r.dividendYield)]]; $('ratio-grid').innerHTML=rows.map(([label,value])=>`<article class="ratio-card"><span>${label}</span><b>${value}</b></article>`).join(''); }
function renderMarketActivity(){
  const s=selected('market-symbol'); if(!s) return;
  const flow=s.shortVolume||{}, latest=flow.latest||{}, activity=s.unusualActivity||{};
  const metrics=[
    ['Short Volume', fmtCap(latest.shortVolume).replace('$','')],
    ['Short Ratio', fmtRatioPct(latest.shortVolumeRatio)],
    ['Short Ratio 20D Avg', fmtRatioPct(flow.avgShortVolumeRatio20)],
    ['Total Volume', fmtCap(latest.totalVolume).replace('$','')],
    ['Volume Spike', Number.isFinite(activity.volumeMultiple)?`${activity.volumeMultiple.toFixed(2)}x`:'N/A'],
    ['Day Range', fmtRatioPct(activity.dayRangePct)],
    ['Opening Gap', Number.isFinite(activity.gapPct)?`${activity.gapPct>0?'+':''}${activity.gapPct.toFixed(2)}%`:'N/A'],
    ['Trade Tape', activity.tickTradesAvailable?'Available':'Plan gated']
  ];
  $('flow-metrics').innerHTML=metrics.map(([label,value])=>`<article class="ratio-card"><span>${label}</span><b>${value}</b></article>`).join('');
  $('flow-summary').innerHTML=`<div><p class="eyebrow">Activity summary</p><h3>${s.symbol} · ${activity.asOf||latest.date||'Latest available'}</h3><p>${activity.summary||'No unusual aggregate activity detected.'}</p><small>Uses Massive short-volume data plus accessible OHLC aggregate volume/range/gap checks. Tick-level trades are not shown unless the Massive plan entitles the trades endpoint.</small></div>`;
  $('flow-signals').innerHTML=(activity.signals?.length?activity.signals:[{label:'No unusual aggregate activity detected',severity:'info'}]).map(sig=>`<div class="alert ${sig.severity||'info'}"><b>${s.symbol}</b>${sig.label}</div>`).join('');
  const rows=flow.history||[];
  $('short-volume-table').innerHTML=`<thead><tr><th>Date</th><th>Short Volume</th><th>Total Volume</th><th>Short Ratio</th><th>Exempt</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${r.date}</td><td>${fmtCap(r.shortVolume).replace('$','')}</td><td>${fmtCap(r.totalVolume).replace('$','')}</td><td>${fmtRatioPct(r.shortVolumeRatio)}</td><td>${fmtCap(r.exemptVolume).replace('$','')}</td></tr>`).join(''):`<tr><td colspan="5">No Massive short-volume rows available for this ticker.</td></tr>`}</tbody>`;
}
function renderFinancial(){ const s=selected('financial-symbol'); if(!s) return; renderCompanyProfile(s); renderRatios(s); const quarters=s.financials?.quarters||[], forecasts=s.financials?.forecast||[]; $('financial-table').innerHTML=`<thead><tr><th>Period</th><th>Revenue</th><th>Net Income</th><th>Op Cash Flow</th><th>Free Cash Flow</th><th>Assets</th><th>Source</th></tr></thead><tbody>${quarters.map(q=>`<tr><td>${q.period}<br><small>${q.end||''}</small></td><td>${usd0(q.revenue)}</td><td>${usd0(q.netIncome)}</td><td>${usd0(q.operatingCashFlow)}</td><td>${usd0(q.freeCashFlow)}</td><td>${usd0(q.assets)}</td><td>${q.source||q.form||'SEC'}</td></tr>`).join('')}${forecasts.map(f=>`<tr class="forecast"><td>${f.period}</td><td>${usd0(f.value)}</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>${f.basis}</td></tr>`).join('') || ''}</tbody>`; const labels=[...quarters.map(q=>q.period),...forecasts.map(f=>f.period)]; const reported=quarters.map(q=>q.revenue).concat(forecasts.map(()=>null)); const forecast=quarters.map(()=>null).concat(forecasts.map(f=>f.value)); if(financialChart) financialChart.destroy(); financialChart=makeLineChart($('financial-chart'),[{label:'Reported revenue',data:reported,borderColor:'#59b4ff',backgroundColor:'#59b4ff',pointRadius:3},{label:'Forecast revenue',data:forecast,borderColor:'#ffd166',backgroundColor:'#ffd166',borderDash:[6,6],pointRadius:3}],labels); }
function sentimentClass(x){ return /BULL/i.test(x||'') ? 'up' : /BEAR/i.test(x||'') ? 'down' : 'flat'; }
function renderList(el, rows, empty, fn){ el.innerHTML = rows?.length ? rows.map(fn).join('') : `<p class="flat">${empty}</p>`; }
function renderInsider(){
  const s=selected('insider-symbol'); if(!s) return;
  const summary=s.insiderSummary || {};
  $('insider-sentiment').textContent=(summary.sentiment||'NEUTRAL').replaceAll('_',' ');
  $('insider-sentiment').className=sentimentClass(summary.sentiment);
  $('insider-score').textContent=`${summary.score ?? '--'}/100`;
  $('insider-total-tx').textContent=fmtNum(summary.totalTransactions);
  $('insider-buy-sell').innerHTML=`<span class="up">${summary.buyCount||0}</span> / <span class="down">${summary.sellCount||0}</span>`;
  $('insider-net-shares').className=cls(summary.netShares);
  $('insider-net-shares').textContent=fmtNum(summary.netShares);
  $('insider-value-flow').innerHTML=`<span class="up">${fmtCap(summary.totalBought)}</span> / <span class="down">${fmtCap(summary.totalSold)}</span>`;

  renderList($('key-insiders'), summary.keyInsiders, 'No open-market insider transactions detected.', i => `
    <div class="insider-row">
      <div><b>${i.owner}</b><small>${i.title || 'Insider'} · ${i.txCount} tx</small></div>
      <div class="right"><span class="${cls(i.netShares)}">${fmtNum(i.netShares)} sh</span><small>Sold ${fmtCap(i.soldValue)} · Bought ${fmtCap(i.boughtValue)}</small></div>
    </div>`);

  renderList($('largest-transactions'), summary.largestTransactions, 'No priced open-market transactions found.', t => `
    <div class="insider-row">
      <div><b>${t.owner}</b><small>${t.date} · ${t.title || 'Insider'}</small></div>
      <div class="right"><span class="${t.type==='BUY'?'up':'down'}">${t.type} ${fmtNum(t.shares)} sh</span><small>${fmtMoney(t.price)} · ${fmtCap(t.value)} · <a class="table-link" href="${t.filingUrl}" target="_blank" rel="noopener">SEC</a></small></div>
    </div>`);

  $('insider-patterns').innerHTML=(summary.patterns?.length?summary.patterns:['No strong open-market pattern detected']).map(p=>`<li><span>＋</span>${p}</li>`).join('');
  $('insider-alerts').innerHTML=(summary.alerts?.length?summary.alerts:['No major insider alert flags.']).map(p=>`<li><span>!</span>${p}</li>`).join('');

  const rows=s.insider||[];
  $('insider-table').innerHTML=`<thead><tr><th>Date</th><th>Insider</th><th>Type</th><th>Shares</th><th>Value</th><th>SEC Filing</th></tr></thead><tbody>${rows.length?rows.map(f=>{
    const tx=(f.transactions||[]).find(t=>['BUY','SELL'].includes(t.type)) || (f.transactions||[])[0] || {};
    return `<tr><td>${tx.date||f.reportDate||f.filingDate||'N/A'}</td><td>${f.owner||'Unknown'}<br><small>${f.title||''}</small></td><td><span class="${tx.type==='BUY'?'up':tx.type==='SELL'?'down':'flat'}">${tx.type||f.dominantType||'FORM 4'}</span></td><td>${fmtNum(tx.shares)}</td><td>${fmtCap(tx.value)}</td><td>${f.url?`<a class="table-link" href="${f.url}" target="_blank" rel="noopener">Open SEC</a>`:'N/A'}</td></tr>`;
  }).join(''):`<tr><td colspan="6">No recent Form 4 filings found in SEC recent submissions.</td></tr>`}</tbody>`;
}
function renderSentiment(summary){ const score=summary.sentimentScore||0; const ring=$('sentiment-score'); ring.textContent=''; ring.style.setProperty('--score',score); ring.dataset.score=score; $('sentiment-label').textContent=score>=65?'BULLISH':score>=45?'NEUTRAL / MIXED':'BEARISH'; for(const [id,pct] of [['bull',summary.bullPct],['neutral',summary.neutralPct],['bear',summary.bearPct]]){ $(`${id}-bar`).style.width=`${pct||0}%`; $(`${id}-pct`).textContent=`${pct||0}%`; } }
function renderPortfolio(summary){ const best=summary.bestPerformer?`${summary.bestPerformer.symbol} ${sign(summary.bestPerformer.ytdPct)}${summary.bestPerformer.ytdPct}%`:'N/A'; const worst=summary.worstPerformer?`${summary.worstPerformer.symbol} ${summary.worstPerformer.ytdPct}%`:'N/A'; $('portfolio-metrics').innerHTML=`<div><dt>Avg RSI (14)</dt><dd>${fmtNum(summary.avgRsi14)}</dd></div><div><dt>Sentiment Score</dt><dd>${summary.sentimentScore}/100</dd></div><div><dt>Best Performer</dt><dd class="up">${best}</dd></div><div><dt>Worst Performer</dt><dd class="down">${worst}</dd></div><div><dt>Market Flow</dt><dd>Massive short volume</dd></div><div><dt>Refresh Time</dt><dd>5AM ICT</dd></div>`; }
function renderAlerts(alerts){ $('alert-count').textContent=`${alerts.length} new`; $('alerts-list').innerHTML=alerts.length?alerts.map(a=>`<div class="alert ${a.severity}"><b>${a.symbol}</b>${a.message}<br><small>${new Date(a.createdAt).toLocaleString()}</small></div>`).join(''):'<p class="flat">No active alerts.</p>'; }
async function render({ manual = false } = {}){ try{ if(manual){ refreshBtn.disabled=true; refreshBtn.textContent='Refreshing...'; $('status-pill').className='status-pill'; $('status-pill').textContent='Refreshing JSON...'; } latestData=await loadData(); renderStatus(latestData); renderTickerStrip(latestData.symbols); renderCards(latestData.symbols); renderComparison(latestData.symbols); for(const id of ['technical-symbol','market-symbol','financial-symbol','insider-symbol']) fillSelect(id,latestData.symbols); renderTechnical(); renderMarketActivity(); renderFinancial(); renderInsider(); renderSentiment(latestData.summary); renderPortfolio(latestData.summary); renderAlerts(latestData.alerts||[]); if(manual){ refreshBtn.textContent='Updated'; setTimeout(()=>{ refreshBtn.textContent='Refresh now'; refreshBtn.disabled=false; },1400); } }catch(err){ $('status-pill').className='status-pill stale'; $('status-pill').textContent=`ERROR · ${err.message}`; if(manual){ refreshBtn.textContent='Retry refresh'; refreshBtn.disabled=false; } console.error(err); } }
refreshBtn.addEventListener('click',()=>render({ manual:true })); ['technical-symbol','market-symbol','financial-symbol','insider-symbol'].forEach(id=>$(id).addEventListener('change',()=>({ 'technical-symbol':renderTechnical, 'market-symbol':renderMarketActivity, 'financial-symbol':renderFinancial, 'insider-symbol':renderInsider }[id]()))); render(); setInterval(render,60000);
