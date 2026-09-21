const SIGNAL_URL='https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/main/trade-desk/signal.json';
const PUSH_API='https://vyvinzpsfhvxdzxfuwiw.supabase.co/functions/v1/trade-desk-push';
const STORAGE_KEY='mrgTradeDeskV15';
const defaults={
  usdCash:24.89,zarCash:0,bwxtQty:0.0388,bwxtInvested:6,bwxtPrice:null,lastSignalId:null,trades:[],prices:{},pendingTrade:null,preferredBroker:'EasyEquities',
  latestSignal:null,signalCashUSD:null,signalCashZAR:null,activeSignalTrades:[],closedSignalTrades:[],pendingProtection:null,usedSignalIds:[],
  us:[
    {ticker:'MU',name:'Micron Technology',action:'GET READY',cls:'wait',why:'AI memory strength; avoid chasing extended moves.'},
    {ticker:'NVDA',name:'NVIDIA',action:'NO',cls:'wait',why:'Exceptional AI growth; wait for cleaner risk/reward.'},
    {ticker:'MRVL',name:'Marvell Technology',action:'GET READY',cls:'prepare',why:'AI infrastructure/custom silicon; watch post-results stabilisation.'},
    {ticker:'MP',name:'MP Materials',action:'NO',cls:'wait',why:'Critical minerals + US policy support; already highly extended.'},
    {ticker:'PLTR',name:'Palantir',action:'NO',cls:'avoid',why:'Strong growth; valuation and momentum can become extreme.'}
  ],
  za:[
    {ticker:'THA',name:'Tharisa',action:'GET READY',cls:'prepare',why:'Chrome/PGM exposure; preferred quality chrome candidate.'},
    {ticker:'DRD',name:'DRDGOLD',action:'GET READY',cls:'wait',why:'Strong gold leverage; avoid buying after vertical moves.'},
    {ticker:'MRF',name:'Merafe Resources',action:'GET READY',cls:'prepare',why:'Higher-risk chrome exposure; potentially faster mover.'},
    {ticker:'ARI',name:'African Rainbow Minerals',action:'GET READY',cls:'prepare',why:'Manganese/diversified miner with identifiable catalysts.'},
    {ticker:'HAR',name:'Harmony Gold',action:'GET READY',cls:'wait',why:'Gold + copper optionality; wait for a better entry.'},
    {ticker:'KIO',name:'Kumba Iron Ore',action:'NO',cls:'wait',why:'Quality asset; China demand remains the major swing factor.'}
  ]
};
const oldKeys=['mrgTradeDeskV11','mrgTradeDeskV10','mrgTradeDeskV9','mrgTradeDeskV8','mrgTradeDeskV7','mrgTradeDeskV6','mrgTradeDeskV5','mrgTradeDeskV3','mrgTradeDeskV2'];
let raw=localStorage.getItem(STORAGE_KEY);
if(!raw){for(const k of oldKeys){raw=localStorage.getItem(k);if(raw)break}}
let data;try{data=raw?JSON.parse(raw):structuredClone(defaults)}catch{data=structuredClone(defaults)}
for(const [k,v] of Object.entries(defaults)){if(data[k]===undefined)data[k]=structuredClone(v)}
if(!Array.isArray(data.trades))data.trades=[];
if(!data.prices||typeof data.prices!=='object')data.prices={};
if(!Array.isArray(data.activeSignalTrades))data.activeSignalTrades=[];
if(!Array.isArray(data.closedSignalTrades))data.closedSignalTrades=[];
if(!Array.isArray(data.usedSignalIds))data.usedSignalIds=[];
if(data.signalCashUSD===null||data.signalCashUSD===undefined)data.signalCashUSD=Math.max(0,Number(data.usdCash)||0);
if(data.signalCashZAR===null||data.signalCashZAR===undefined)data.signalCashZAR=Math.max(0,Number(data.zarCash)||0);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}
function money(v,c){return String(c).toUpperCase()==='USD'?'$'+Number(v||0).toFixed(2):'R'+Number(v||0).toFixed(2)}
function fmtCurrency(v,currency){return money(v,currency)}
function esc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function el(id){return document.getElementById(id)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function roundMoney(v){return Math.round((Number(v)||0)*100)/100}
function renderCash(){
  el('usdCash').textContent=money(data.usdCash,'USD');el('zarCash').textContent=money(data.zarCash,'ZAR');
  const sig=data.latestSignal;const cur=signalCurrency(sig);
  el('heroCash').textContent=cur==='ZAR'?money(data.zarCash,'ZAR'):money(data.usdCash,'USD');
}
function renderBWXT(){const p=el('bwxtPrice'),v=el('bwxtValue'),pl=el('bwxtPL');if(!data.bwxtPrice){p.textContent=v.textContent=pl.textContent='—';pl.className='';return}const val=data.bwxtQty*data.bwxtPrice,delta=val-data.bwxtInvested;p.textContent='$'+data.bwxtPrice.toFixed(2);v.textContent='$'+val.toFixed(2);pl.textContent=(delta>=0?'+':'')+'$'+delta.toFixed(2);pl.className=delta>=0?'positive':'negative'}
function renderList(id,items){el(id).innerHTML=items.map(x=>`<article class="watch-item"><div class="ticker">${x.ticker}</div><div><div class="name">${x.name}</div><div class="why">${x.why}</div></div><div class="action ${x.cls}">${x.action}</div><div class="watch-actions trade-pair"><button class="buy-btn" onclick="openTrade('${x.ticker}','buy')">BUY</button><button class="sell-btn" onclick="openTrade('${x.ticker}','sell')">SELL</button></div></article>`).join('')}
const US_TICKERS=new Set(['BWXT','MU','NVDA','MRVL','MP','PLTR']);
const ZA_TICKERS=new Set(['THA','DRD','MRF','ARI','HAR','KIO']);
const EE_BUY='https://platform.easyequities.io/ValueAllocation/Buy';
const EE_SELL='https://platform.easyequities.io/Sell';
const EE_HOME='https://platform.easyequities.io/';
const IBKR_PORTAL='https://portal.interactivebrokers.com/en/trading/client-portal.php?menu=B';
const VERIFIED_BUY_URLS={BWXT:'https://platform.easyequities.io/ValueAllocation/Buy?contractCode=EQU.US.BWXT&tradingCurrencyId=10',HAR:'https://platform.easyequities.io/ValueAllocation/Buy?contractCode=EQU.ZA.HAR&tradingCurrencyId=2'};
function marketInfo(ticker){ticker=String(ticker||'').trim().toUpperCase();if(US_TICKERS.has(ticker))return {market:'US',currency:'USD',currencyId:10,contract:`EQU.US.${ticker}`};if(ZA_TICKERS.has(ticker))return {market:'ZA',currency:'ZAR',currencyId:2,contract:`EQU.ZA.${ticker}`};return null}
function signalCurrency(s){const c=String(s?.currency||'').toUpperCase();if(c==='USD'||c==='ZAR')return c;return marketInfo(s?.ticker)?.currency||'USD'}
function getBuyUrl(ticker){ticker=String(ticker||'').trim().toUpperCase();if(VERIFIED_BUY_URLS[ticker])return VERIFIED_BUY_URLS[ticker];const info=marketInfo(ticker);if(!info)return null;return `${EE_BUY}?contractCode=${encodeURIComponent(info.contract)}&tradingCurrencyId=${info.currencyId}`}
function getSellUrl(ticker){const info=marketInfo(ticker);if(!info)return EE_SELL;return `${EE_SELL}?contractCode=${encodeURIComponent(info.contract)}&tradingCurrencyId=${info.currencyId}`}
async function copyQuiet(text){try{await navigator.clipboard?.writeText(String(text))}catch{}}
async function openTrade(ticker,side,meta={}){
  ticker=String(ticker||'').trim().toUpperCase();side=String(side||'').toLowerCase();if(!ticker||!['buy','sell'].includes(side))return;
  const info=marketInfo(ticker);
  data.pendingTrade={ticker,side,currency:info?.currency||'',openedAt:new Date().toISOString(),broker:data.preferredBroker||'EasyEquities',...meta};save();
  await copyQuiet(ticker);
  if((data.preferredBroker||'EasyEquities')==='IBKR'){toast(`${ticker} copied — opening IBKR Client Portal`);window.location.href=IBKR_PORTAL;return}
  if(side==='buy'){const direct=getBuyUrl(ticker);if(direct){toast(`Opening BUY ${ticker}`);window.location.href=direct;return}toast(`${ticker} copied — opening EasyEquities`);window.location.href=EE_HOME;return}
  toast(`Opening SELL ${ticker}`);window.location.href=getSellUrl(ticker);
}
function clsFor(action=''){const a=String(action).toUpperCase();if(a==='SELL'||a==='NO')return 'sell';if(a==='BUY')return 'buy';if(a==='GET READY')return 'wait';return 'hold'}
function parseExpiry(s){const v=s?.valid_until||s?.expires_at;if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d:null}
function formatDateTime(v){if(!v)return '—';const d=new Date(v);if(!Number.isFinite(d.getTime()))return String(v);return d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'})}
function signalEntryRef(s){const p=num(s?.entry_price);if(p&&p>0)return p;const lo=num(s?.entry_min),hi=num(s?.entry_max);if(lo&&hi)return (lo+hi)/2;if(lo)return lo;if(hi)return hi;return null}
function signalRiskEntry(s){const hi=num(s?.entry_max);if(hi&&hi>0)return hi;return signalEntryRef(s)}
function signalEntryText(s){if(s?.entry_zone)return String(s.entry_zone);const c=signalCurrency(s),lo=num(s?.entry_min),hi=num(s?.entry_max),p=num(s?.entry_price);if(lo&&hi)return `${money(lo,c)} – ${money(hi,c)}`;if(p)return money(p,c);return '—'}
function signalAmount(s){if(String(s?.action||'').toUpperCase()!=='BUY')return 0;const pct=num(s?.allocation_pct);if(!pct||pct<=0)return 0;const cur=signalCurrency(s),cash=cur==='USD'?Number(data.signalCashUSD)||0:Number(data.signalCashZAR)||0;return roundMoney(cash*Math.min(pct,25)/100)}
function signalPlanCheck(s){
  if(!s||String(s.action||'').toUpperCase()!=='BUY')return {ok:false,reason:'No active BUY signal'};
  if(s.id&&data.usedSignalIds.includes(s.id))return {ok:false,reason:'This BUY signal has already been used'};
  if(data.pendingTrade?.source==='signal'&&data.pendingTrade?.signalId&&data.pendingTrade.signalId===s.id)return {ok:false,reason:'BUY already opened — record or cancel it first'};
  const expiry=parseExpiry(s);
  if(expiry&&Date.now()>expiry.getTime())return {ok:false,reason:'Signal expired — wait for a fresh signal'};
  if(!expiry){const u=new Date(s.updated_at||'');if(!Number.isFinite(u.getTime())||Date.now()-u.getTime()>6*60*60*1000)return {ok:false,reason:'BUY signal is stale or missing an expiry'};}
  const pct=num(s.allocation_pct);if(!pct||pct<=0||pct>25)return {ok:false,reason:'Position size is missing or outside the 25% cap'};
  const entry=signalRiskEntry(s),target=num(s.take_profit),stop=num(s.stop_loss);
  if(!entry||!target||!stop||stop>=entry||target<=entry)return {ok:false,reason:'Entry / target / stop plan is incomplete'};
  const days=num(s.max_hold_days);if(days&&days>10)return {ok:false,reason:'Signal holding window exceeds the short-trade limit'};
  const risk=(entry-stop)/entry,reward=(target-entry)/entry,rr=risk>0?reward/risk:0;
  if(rr<1.5)return {ok:false,reason:'Reward/risk is below the 1.5× minimum at the worst planned entry'};
  if(signalAmount(s)<=0)return {ok:false,reason:`Set ${signalCurrency(s)} Signal Cash first`};
  return {ok:true,entry,target,stop,risk,reward,rr};
}
function calcSignalRealized(){
  const groups=new Map(),realized={USD:0,ZAR:0};
  for(const t of [...data.trades].filter(x=>x.source==='signal'&&x.signalTradeId).sort((a,b)=>String(a.date).localeCompare(String(b.date)))){
    const id=t.signalTradeId;if(!groups.has(id))groups.set(id,{qty:0,cost:0,currency:t.currency||'USD'});const g=groups.get(id);const q=Math.max(0,Number(t.qty)||0),total=Math.max(0,Number(t.total)||0);g.currency=t.currency||g.currency;
    if(t.side==='BUY'){g.qty+=q;g.cost+=total}else if(t.side==='SELL'&&q>0&&g.qty>0){const sellQty=Math.min(q,g.qty),avg=g.cost/g.qty,removed=avg*sellQty;realized[g.currency]=(realized[g.currency]||0)+(total-removed);g.qty-=sellQty;g.cost=Math.max(0,g.cost-removed)}
  }
  return realized;
}
function renderSignalTrade(){
  const s=data.latestSignal||{};const action=String(s.action||'NO').toUpperCase();const ticker=String(s.ticker||'—').toUpperCase();const cur=signalCurrency(s);const amount=signalAmount(s);const check=signalPlanCheck(s);
  el('signalCashUsd').textContent=money(data.signalCashUSD,'USD');el('signalCashZar').textContent=money(data.signalCashZAR,'ZAR');
  const active=data.activeSignalTrades.filter(x=>!x.closedAt);const byCur={USD:0,ZAR:0};for(const t of active)byCur[t.currency]=(byCur[t.currency]||0)+(Number(t.cost)||0);
  el('signalInvested').textContent=(byCur.USD?money(byCur.USD,'USD'):'')+(byCur.USD&&byCur.ZAR?' / ':'')+(byCur.ZAR?money(byCur.ZAR,'ZAR'):'')||'—';el('signalInvestedNote').textContent=active.length?`${active.length} active signal trade${active.length===1?'':'s'}`:'No active signal trade';
  const sr=calcSignalRealized();el('signalRealized').textContent=(Math.abs(sr.USD)>0.0001?`${sr.USD>=0?'+':''}${money(sr.USD,'USD')}`:'')+(Math.abs(sr.USD)>0.0001&&Math.abs(sr.ZAR)>0.0001?' / ':'')+(Math.abs(sr.ZAR)>0.0001?`${sr.ZAR>=0?'+':''}${money(sr.ZAR,'ZAR')}`:'')||'$0.00 / R0.00';el('signalRealized').className=(sr.USD>=0&&sr.ZAR>=0)?'positive':'';
  el('signalTradeAction').textContent=action;el('signalTradeTicker').textContent=ticker;el('signalTradeReason').textContent=s.reason||'Waiting for a valid BUY signal. Cash stays ready until the setup meets the rules.';
  el('signalEntry').textContent=signalEntryText(s);el('signalTarget').textContent=num(s.take_profit)?money(s.take_profit,cur):'—';el('signalStop').textContent=num(s.stop_loss)?money(s.stop_loss,cur):'—';
  el('signalAllocation').textContent=num(s.allocation_pct)?`${Math.min(Number(s.allocation_pct),25)}% of ${cur} Signal Cash`:'—';el('signalTradeAmount').textContent=amount?money(amount,cur):'—';
  const entry=signalEntryRef(s),target=num(s.take_profit),stop=num(s.stop_loss);let rr='—';if(entry&&target&&stop&&stop<entry&&target>entry)rr=((target-entry)/(entry-stop)).toFixed(2)+'×';el('signalRR').textContent=rr;
  el('signalValidUntil').textContent=s.valid_until?formatDateTime(s.valid_until):'Until signal changes';
  const pill=el('signalTradePill');pill.textContent=action==='BUY'?'BUY':action;pill.className='pill '+clsFor(action);
  const btn=el('signalBuyNow');btn.disabled=!check.ok;btn.textContent=check.ok?`BUY ${ticker} — ${money(amount,cur)} NOW`:(action==='GET READY'?'GET READY — DO NOT BUY':action==='NO'?'NO TRADE':action==='SELL'?'SELL SIGNAL — USE EXIT PLAN':'NO ACTIVE BUY');
  btn.className='signal-buy-now '+(check.ok?'ready':'');
  if(check.ok){const riskCash=amount*check.risk,profitCash=amount*check.reward;el('signalRiskLine').textContent=`Planned downside ≈ ${money(riskCash,cur)} to Stop Loss; planned upside ≈ ${money(profitCash,cur)} to Take Profit before fees/slippage.`}
  else el('signalRiskLine').textContent=check.reason||'No capital is committed until you confirm the BUY in EasyEquities.';
}
function editSignalCash(currency){currency=String(currency).toUpperCase();const key=currency==='USD'?'signalCashUSD':'signalCashZAR';const current=Number(data[key])||0;const v=prompt(`Set ${currency} Signal Cash. This is a virtual trading pot only — no money is moved:`,current);if(v===null)return;const n=Number(String(v).replace(/[^0-9.\-]/g,''));if(!Number.isFinite(n)||n<0)return alert('Enter a valid amount.');data[key]=roundMoney(n);save();renderSignalTrade();toast(`${currency} Signal Cash updated`)}
function openSignalBuy(){
  const s=data.latestSignal;const check=signalPlanCheck(s);if(!check.ok)return alert(check.reason);
  const ticker=String(s.ticker).toUpperCase(),currency=signalCurrency(s),amount=signalAmount(s);
  const existing=data.activeSignalTrades.find(x=>!x.closedAt&&x.ticker===ticker);if(existing&&!confirm(`${ticker} already has an active Signal Trade. Buy another signal allocation anyway?`))return;
  openTrade(ticker,'buy',{source:'signal',plannedAmount:amount,signalId:s.id||'',signalSnapshot:{ticker,allocation_pct:s.allocation_pct,entry_price:s.entry_price??null,entry_min:s.entry_min??null,entry_max:s.entry_max??null,entry_zone:s.entry_zone??null,take_profit:s.take_profit,stop_loss:s.stop_loss,valid_until:s.valid_until??null,max_hold_days:s.max_hold_days??null,reason:s.reason||''}});
}
function calcPortfolio(){
  const positions={},realized={USD:0,ZAR:0};positions.BWXT={ticker:'BWXT',qty:Number(data.bwxtQty)||0,cost:Number(data.bwxtInvested)||0,currency:'USD'};
  const sorted=[...data.trades].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  for(const t of sorted){const ticker=String(t.ticker||'').toUpperCase(),qty=Math.max(0,Number(t.qty)||0),total=Math.max(0,Number(t.total)||0),currency=t.currency||marketInfo(ticker)?.currency||'ZAR';if(!positions[ticker])positions[ticker]={ticker,qty:0,cost:0,currency};const p=positions[ticker];if(t.side==='BUY'){p.qty+=qty;p.cost+=total;p.currency=currency}else if(t.side==='SELL'&&qty>0){const avg=p.qty>0?p.cost/p.qty:0,sellQty=Math.min(qty,p.qty),removedCost=avg*sellQty;realized[currency]=(realized[currency]||0)+(total-removedCost);p.qty=Math.max(0,p.qty-sellQty);p.cost=Math.max(0,p.cost-removedCost);if(p.qty<1e-10){p.qty=0;p.cost=0}}}
  return {positions,realized};
}
function renderTradeTracker(){
  const host=el('tradeHistory');if(!host)return;const {positions,realized}=calcPortfolio();el('realizedUsd').textContent=fmtCurrency(realized.USD,'USD');el('realizedZar').textContent=fmtCurrency(realized.ZAR,'ZAR');const open=Object.values(positions).filter(p=>p.qty>1e-10);el('openPositions').textContent=String(open.length);el('tradeCount').textContent=String(data.trades.length);el('holdingsCount').textContent=String(open.length);el('holdingsNote').textContent=open.length?open.map(p=>p.ticker).join(', '):'None recorded';
  el('openPositionList').innerHTML=open.map(p=>{const avg=p.qty?p.cost/p.qty:0,px=Number(data.prices[p.ticker])||0,upl=px?px*p.qty-p.cost:null;return `<div class="portfolio-row"><div><strong>${esc(p.ticker)}</strong><span>${p.qty.toFixed(4)} shares · avg ${fmtCurrency(avg,p.currency)}</span></div><div class="portfolio-values"><strong>${fmtCurrency(p.cost,p.currency)} cost</strong>${upl===null?`<button class="tiny-link" onclick="setTrackerPrice('${esc(p.ticker)}')">Add price</button>`:`<span class="${upl>=0?'positive':'negative'}">Est. P/L ${upl>=0?'+':''}${fmtCurrency(upl,p.currency)}</span>`}</div></div>`}).join('')||'<div class="empty-state">No open positions recorded.</div>';
  const rows=[...data.trades].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,30);host.innerHTML=rows.map(t=>`<div class="trade-row"><div><span class="trade-side ${t.side==='BUY'?'buy-side':'sell-side'}">${esc(t.side)}${t.source==='signal'?' · SIGNAL':''}</span><strong>${esc(t.ticker)}</strong><span class="trade-date">${new Date(t.date).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</span></div><div class="trade-values"><strong>${fmtCurrency(t.total,t.currency)}</strong><span>${Number(t.qty).toFixed(4)} shares · ${fmtCurrency(t.price,t.currency)}/share</span></div><button class="delete-trade" aria-label="Delete trade" onclick="deleteTrade('${esc(t.id)}')">×</button></div>`).join('')||'<div class="empty-state">No completed trades logged yet. After you return from EasyEquities, the app will ask whether the trade completed.</div>';
  renderPendingTrade();renderSignalPositions();renderSignalTrade();
}
function renderPendingTrade(){const box=el('pendingTradeBox');if(!box)return;const p=data.pendingTrade;if(!p){box.hidden=true;return}box.hidden=false;box.innerHTML=`<div><strong>Did ${esc(p.side.toUpperCase())} ${esc(p.ticker)} complete?</strong><span>${p.source==='signal'?'Signal Trade: record the actual EasyEquities fill so the exit plan uses the real entry.':'Only record it after EasyEquities confirms the trade.'}</span></div><div class="pending-buttons"><button class="buy-btn" onclick="recordPendingTrade()">YES, RECORD</button><button class="secondary" onclick="clearPendingTrade()">NO</button></div>`}
function promptNumber(label,def=''){const v=prompt(label,def);if(v===null)return null;const n=Number(String(v).replace(/[^0-9.\-]/g,''));if(!Number.isFinite(n)||n<=0){alert('Enter a valid number.');return null}return n}
function recordPendingTrade(){const p=data.pendingTrade;if(!p)return;recordTrade(p.ticker,p.side,p.currency,true)}
function createSignalTradeFromBuy(p,total,qty,price){
  const snap=p.signalSnapshot||{},id=`sigtrade-${Date.now()}-${p.ticker}`;const cur=p.currency||signalCurrency(snap);const key=cur==='USD'?'signalCashUSD':'signalCashZAR';const available=Number(data[key])||0;
  if(total>available+0.01&&!confirm(`Actual cost ${money(total,cur)} is above the ${money(available,cur)} Signal Cash recorded. Record it anyway?`))return null;
  data[key]=roundMoney(Math.max(0,available-total));
  const active={id,signalId:p.signalId||'',ticker:p.ticker,currency:cur,qty,cost:total,entryPrice:price,plannedAmount:p.plannedAmount||null,takeProfit:num(snap.take_profit),stopLoss:num(snap.stop_loss),entryMin:num(snap.entry_min),entryMax:num(snap.entry_max),entryZone:snap.entry_zone||'',openedAt:new Date().toISOString(),protectionOrder:null,protectionLevel:null,manualExit:false,reason:snap.reason||''};
  data.activeSignalTrades.push(active);if(p.signalId&&!data.usedSignalIds.includes(p.signalId))data.usedSignalIds.push(p.signalId);return active;
}
function applySignalExit(activeId,total,qty){
  const t=data.activeSignalTrades.find(x=>x.id===activeId&&!x.closedAt);if(!t)return;const sellQty=Math.min(Number(qty)||0,Number(t.qty)||0),oldQty=Number(t.qty)||0;if(oldQty<=0)return;const costRemoved=(Number(t.cost)||0)*(sellQty/oldQty);t.qty=oldQty-sellQty;t.cost=Math.max(0,(Number(t.cost)||0)-costRemoved);const key=t.currency==='USD'?'signalCashUSD':'signalCashZAR';data[key]=roundMoney((Number(data[key])||0)+Number(total||0));if(t.qty<1e-10){t.qty=0;t.cost=0;t.closedAt=new Date().toISOString();t.realizedPnL=roundMoney(Number(total||0)-costRemoved);data.closedSignalTrades.push({...t});data.activeSignalTrades=data.activeSignalTrades.filter(x=>x.id!==activeId)}
}
function recordTrade(ticker='',side='',currency='',fromPending=false){
  const p=fromPending?data.pendingTrade:null;ticker=String(ticker||prompt('Ticker / stock code:','')).trim().toUpperCase();if(!ticker)return;side=String(side||prompt('Type BUY or SELL:','BUY')).trim().toUpperCase();if(!['BUY','SELL'].includes(side))return alert('Use BUY or SELL.');if(!currency){const cv=prompt('Currency: USD or ZAR','ZAR');if(cv===null)return;currency=cv.trim().toUpperCase()}currency=String(currency).toUpperCase();if(!['USD','ZAR'].includes(currency))return alert('Use USD or ZAR.');
  const total=promptNumber(side==='BUY'?`Total paid for ${ticker}, including fees (${currency}):`:`Total received for ${ticker}, after fees (${currency}):`,p?.plannedAmount||'');if(total===null)return;const qty=promptNumber(`Number of ${ticker} shares ${side==='BUY'?'received':'sold'}:`);if(qty===null)return;if(side==='SELL'){const held=calcPortfolio().positions[ticker]?.qty||0;if(qty>held+1e-9)return alert(`You have ${held.toFixed(4)} ${ticker} shares recorded. Enter a sell quantity at or below that.`)}
  const price=total/qty;let signalTradeId=p?.activeSignalTradeId||null;if(side==='BUY'&&p?.source==='signal'){const active=createSignalTradeFromBuy(p,total,qty,price);if(!active)return;signalTradeId=active.id}
  if(side==='SELL'&&p?.source==='signal'&&signalTradeId)applySignalExit(signalTradeId,total,qty);
  data.trades.push({id:`${Date.now()}-${ticker}-${side}`,date:new Date().toISOString(),ticker,side,currency,total,qty,price,source:p?.source||'manual',signalTradeId});if(fromPending)data.pendingTrade=null;save();renderTradeTracker();toast(`${side} ${ticker} recorded`);
}
function clearPendingTrade(){data.pendingTrade=null;save();renderPendingTrade();toast('Trade not recorded')}
function deleteTrade(id){if(!confirm('Delete this trade from the local history? This does not reverse Signal Cash automatically.'))return;data.trades=data.trades.filter(t=>t.id!==id);save();renderTradeTracker()}
function setTrackerPrice(ticker){const currency=marketInfo(ticker)?.currency||'ZAR';const n=promptNumber(`Latest ${ticker} price (${currency}):`,data.prices[ticker]||'');if(n===null)return;data.prices[ticker]=n;if(ticker==='BWXT')data.bwxtPrice=n;save();renderBWXT();renderTradeTracker()}
function exportTrades(){const lines=[['Date','Ticker','Side','Source','Currency','Total','Quantity','Price per share','Signal trade ID'],...data.trades.map(t=>[t.date,t.ticker,t.side,t.source||'manual',t.currency,t.total,t.qty,t.price,t.signalTradeId||''])];const csv=lines.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='MrG-Trade-Desk-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function signalTradeRR(t){const e=Number(t.entryPrice)||0,tp=Number(t.takeProfit)||0,sl=Number(t.stopLoss)||0;if(!e||!tp||!sl||sl>=e||tp<=e)return null;return (tp-e)/(e-sl)}
function renderSignalPositions(){
  const host=el('activeSignalTrades');if(!host)return;const active=data.activeSignalTrades.filter(x=>!x.closedAt);if(!active.length){host.innerHTML='<div class="empty-state">No active Signal Trade yet. When a BUY signal completes, its Stop Loss and Take Profit plan will appear here.</div>';renderProtectionPrompt();return}
  host.innerHTML=active.map(t=>{const rr=signalTradeRR(t),order=t.protectionOrder?`${t.protectionOrder.replace('_',' ')} ${t.protectionLevel?money(t.protectionLevel,t.currency):''}`:'NOT SET';return `<div class="signal-position"><div class="signal-position-top"><div><span class="trade-side buy-side">SIGNAL</span><strong>${esc(t.ticker)}</strong><small>${Number(t.qty).toFixed(4)} shares · entry ${money(t.entryPrice,t.currency)}</small></div><div class="signal-position-cost"><span>Cost</span><strong>${money(t.cost,t.currency)}</strong></div></div><div class="exit-levels"><div><span>TAKE PROFIT</span><strong>${t.takeProfit?money(t.takeProfit,t.currency):'—'}</strong></div><div><span>STOP LOSS</span><strong>${t.stopLoss?money(t.stopLoss,t.currency):'—'}</strong></div><div><span>R / R</span><strong>${rr?rr.toFixed(2)+'×':'—'}</strong></div><div><span>ACTIVE SELL ORDER</span><strong>${esc(order)}</strong></div></div><div class="exit-actions"><button class="stop-btn" ${!t.stopLoss?'disabled':''} onclick="setProtection('${t.id}','STOP_LOSS')">SET STOP LOSS</button><button class="take-btn" ${!t.takeProfit?'disabled':''} onclick="setProtection('${t.id}','TAKE_PROFIT')">SET TAKE PROFIT</button><button class="sell-btn" onclick="openSignalSell('${t.id}')">SELL NOW</button><button class="secondary" onclick="recordSignalExit('${t.id}')">RECORD EXIT</button></div><p class="signal-position-note">${(t.stopLoss&&t.takeProfit&&(t.stopLoss>=t.entryPrice||t.takeProfit<=t.entryPrice||rr===null||rr<1.2))?'<strong class="negative">Actual fill changed the risk plan — review before setting an advanced order.</strong><br>':''}Recommended protection: Stop Loss first. If EasyEquities disables Advanced Orders for this instrument, use SELL NOW when Trade Desk issues the exit signal.</p></div>`}).join('');renderProtectionPrompt();
}
async function setProtection(id,type){
  const t=data.activeSignalTrades.find(x=>x.id===id&&!x.closedAt);if(!t)return;const level=type==='STOP_LOSS'?Number(t.stopLoss):Number(t.takeProfit);if(!level)return alert('No valid level is stored for this trade.');
  if(t.protectionOrder&&t.protectionOrder!==type&&!confirm(`EasyEquities allows one SELL order per share. Switch from ${t.protectionOrder.replace('_',' ')} to ${type.replace('_',' ')}? You must cancel/update the existing order in EasyEquities.`))return;
  data.pendingProtection={activeId:id,type,level,openedAt:new Date().toISOString()};save();await copyQuiet(String(level));toast(`${type.replace('_',' ')} ${money(level,t.currency)} copied`);window.location.href=getSellUrl(t.ticker);
}
function renderProtectionPrompt(){const box=el('protectionPrompt');if(!box)return;const p=data.pendingProtection;if(!p){box.hidden=true;return}const t=data.activeSignalTrades.find(x=>x.id===p.activeId&&!x.closedAt);if(!t){data.pendingProtection=null;save();box.hidden=true;return}box.hidden=false;box.innerHTML=`<div><strong>Did you set ${esc(p.type.replace('_',' '))} for ${esc(t.ticker)} at ${money(p.level,t.currency)}?</strong><span>Confirm only after it appears under Pending Orders in EasyEquities.</span></div><div class="pending-buttons"><button class="buy-btn" onclick="confirmProtection(true)">YES</button><button class="secondary" onclick="confirmProtection(false)">NO</button></div>`}
function confirmProtection(ok){const p=data.pendingProtection;if(!p)return;const t=data.activeSignalTrades.find(x=>x.id===p.activeId&&!x.closedAt);if(ok&&t){t.protectionOrder=p.type;t.protectionLevel=p.level;t.protectionSetAt=new Date().toISOString()}data.pendingProtection=null;save();renderSignalPositions();toast(ok?'Protection recorded':'Protection not recorded')}
function openSignalSell(id){const t=data.activeSignalTrades.find(x=>x.id===id&&!x.closedAt);if(!t)return;if(t.protectionOrder&&!confirm(`A ${t.protectionOrder.replace('_',' ')} sell order is recorded. EasyEquities says you must cancel it before a manual sell. Continue to Sell?`))return;openTrade(t.ticker,'sell',{source:'signal',activeSignalTradeId:t.id})}
function recordSignalExit(id){const t=data.activeSignalTrades.find(x=>x.id===id&&!x.closedAt);if(!t)return;data.pendingTrade={ticker:t.ticker,side:'sell',currency:t.currency,source:'signal',activeSignalTradeId:t.id,openedAt:new Date().toISOString()};save();renderPendingTrade();el('pendingTradeBox')?.scrollIntoView({behavior:'smooth',block:'center'})}
function openPortfolio(){window.location.href=(data.preferredBroker||'EasyEquities')==='IBKR'?IBKR_PORTAL:EE_HOME}
function copyText(txt){navigator.clipboard?.writeText(txt);toast('Copied '+txt)}
function toast(msg){const x=el('toast');x.textContent=msg;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2400)}
function editCash(type){const current=type==='usd'?data.usdCash:data.zarCash,v=prompt('Enter '+type.toUpperCase()+' cash balance:',current);if(v===null)return;const n=Number(v);if(!Number.isFinite(n)||n<0)return alert('Enter a valid amount.');if(type==='usd')data.usdCash=n;else data.zarCash=n;save();renderCash()}
function updateBWXTPrice(){const v=prompt('Enter the latest BWXT price in USD:',data.bwxtPrice??'');if(v===null)return;const n=Number(v);if(!Number.isFinite(n)||n<=0)return alert('Enter a valid price.');data.bwxtPrice=n;data.prices.BWXT=n;save();renderBWXT();renderTradeTracker()}
function applySignal(s,notify=false){
  if(!s)return;data.latestSignal=s;el('heroAction').textContent=s.action||'HOLD';el('heroTicker').textContent=s.ticker||'BWXT';el('heroReason').textContent=s.reason||'No change.';el('heroUrgency').textContent=s.urgency||'No rush';el('signalUpdated').textContent=s.updated_label||s.updated_at||'—';el('heroPosition').textContent=s.position||'—';const cls=clsFor(s.action);el('heroPill').textContent=s.action||'HOLD';el('heroPill').className='pill '+cls;el('heroCard').className='hero-signal card '+cls;const liveTicker=(s.ticker||'').toUpperCase();if(liveTicker==='BWXT'){el('bwxtAction').textContent=s.owned_action||s.reason||'Hold';el('bwxtPill').textContent=s.action||'HOLD';el('bwxtPill').className='pill '+cls}const listKey=US_TICKERS.has(liveTicker)?'us':(ZA_TICKERS.has(liveTicker)?'za':null);if(listKey){const row=data[listKey].find(x=>x.ticker===liveTicker);if(row){row.action=s.action||row.action;row.cls=cls;row.why=s.reason||row.why;renderList(listKey==='us'?'usList':'zaList',data[listKey])}}if(notify&&s.id&&s.id!==data.lastSignalId&&Notification.permission==='granted'){navigator.serviceWorker?.ready.then(reg=>reg.showNotification(`Trade Desk: ${s.action} ${s.ticker}`,{body:signalNotificationBody(s),icon:'icon-192.svg',badge:'icon-192.svg',tag:'trade-signal-open-app',renotify:true,data:{url:'./'}}))}if(s.id)data.lastSignalId=s.id;save();renderCash();renderSignalTrade();renderAgentCouncil();renderBroker();
}
function signalNotificationBody(s){const parts=[];if(String(s?.action||'').toUpperCase()==='BUY'&&num(s.allocation_pct))parts.push(`${Math.min(Number(s.allocation_pct),25)}% of Signal Cash`);const c=signalCurrency(s);if(num(s?.take_profit))parts.push(`Target ${money(s.take_profit,c)}`);if(num(s?.stop_loss))parts.push(`Stop ${money(s.stop_loss,c)}`);if(parts.length)return parts.join(' · ');return s?.reason||'A new trade signal is available.'}
async function syncSignal(manual=false){el('syncStatus').textContent='Checking…';el('syncDot').className='sync-dot';try{const r=await fetch(`${SIGNAL_URL}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error('signal unavailable');const s=await r.json(),changed=!!s.id&&s.id!==data.lastSignalId;applySignal(s,changed);el('syncDot').className='sync-dot ok';el('syncStatus').textContent='Signal synced '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(manual)toast(changed?'New signal loaded':'Signal is current')}catch{el('syncDot').className='sync-dot bad';el('syncStatus').textContent='Using last saved signal';if(manual)toast('Could not refresh signal')}}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4),base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)))}
async function registerPush(reg,showToast=false){const keyRes=await fetch(`${PUSH_API}?action=key`,{cache:'no-store'});if(!keyRes.ok){const detail=await keyRes.text();throw new Error('Push key unavailable: '+detail)}const {publicKey}=await keyRes.json();if(!publicKey)throw new Error('Push key missing');let subscription=await reg.pushManager.getSubscription();const storedKey=localStorage.getItem('mrgTradeDeskPushKey');if(subscription&&storedKey!==publicKey){try{await subscription.unsubscribe()}catch{}subscription=null}if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});const response=await fetch(PUSH_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',subscription})});if(!response.ok){const detail=await response.text();throw new Error('Push registration failed: '+detail)}const result=await response.json();if(!result.ok)throw new Error(result.error||'Push registration failed');localStorage.setItem('mrgTradeDeskPushKey',publicKey);el('notifyBtn').textContent='Push alerts on';el('notifyBtn').classList.add('enabled');if(showToast)toast(result.testSent?'Web Push connected — test sent':'Push connected — test pending');return true}
async function enableNotifications(){if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))return alert('Web Push is not supported by this browser.');const permission=await Notification.requestPermission();if(permission!=='granted'){el('notifyBtn').textContent='Alerts blocked';return}el('notifyBtn').textContent='Connecting…';try{const reg=await navigator.serviceWorker.ready;await registerPush(reg,true)}catch(error){console.error(error);el('notifyBtn').textContent='Retry alerts';toast('Web Push connection failed — tap Retry')}}
async function updatePushStatus(reg){if(!('Notification'in window)||!('PushManager'in window)){el('notifyBtn').style.display='none';return}if(Notification.permission==='denied'){el('notifyBtn').textContent='Alerts blocked';return}if(Notification.permission!=='granted'){el('notifyBtn').textContent='Enable push alerts';return}try{const subscription=await reg.pushManager.getSubscription();if(subscription){el('notifyBtn').textContent='Push alerts on';el('notifyBtn').classList.add('enabled');await registerPush(reg,false)}else el('notifyBtn').textContent='Enable push alerts'}catch{el('notifyBtn').textContent='Retry alerts'}}
renderCash();renderBWXT();renderList('usList',data.us);renderList('zaList',data.za);renderTradeTracker();if(data.latestSignal)applySignal(data.latestSignal,false);
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js?v=11').then(async()=>{const reg=await navigator.serviceWorker.ready;await updatePushStatus(reg);await syncSignal(false)}).catch(()=>syncSignal(false))}else syncSignal(false);
setInterval(()=>syncSignal(false),5*60*1000);
function normalizeAgentAction(v){const a=String(v||'WAITING').toUpperCase();return ['BUY','HOLD','SELL','WAIT','GET READY','NO','WAITING'].includes(a)?a:'WAITING'}
function agentNode(s,key){const a=s?.agents||{};return a[key]||a[key.replace('_manager','')]||null}
function renderAgentCouncil(){
  const s=data.latestSignal||{};
  const defs=[['Fundamental','fundamental'],['Technical','technical'],['Risk','risk_manager'],['Portfolio','portfolio_manager']];
  let present=0;
  for(const [label,key] of defs){
    const node=agentNode(s,key);if(node)present++;
    const action=normalizeAgentAction(node?.action||node?.verdict);
    const reason=node?.reason||node?.summary||'No agent result attached to the current signal yet.';
    const conf=Number(node?.confidence);
    el(`agent${label}Action`).textContent=action;
    el(`agent${label}Action`).className='agent-action '+clsFor(action);
    el(`agent${label}Reason`).textContent=reason;
    el(`agent${label}Confidence`).textContent=Number.isFinite(conf)?`Confidence ${Math.round(conf<=1?conf*100:conf)}%`:'—';
  }
  const combined=String(s.action||'WAITING').toUpperCase();
  el('agentCombinedDecision').textContent=combined;
  el('agentCombinedDecision').className='agent-combined '+clsFor(combined);
  el('agentDecisionSource').textContent=present===4?'4-agent council':present?`${present}/4 agents published`:'Legacy signal';
  el('agentRunTime').textContent=s.agent_run_at?formatDateTime(s.agent_run_at):(s.updated_at?formatDateTime(s.updated_at):'—');
  const pill=el('engineStatusPill');pill.textContent=present===4?'AGENTS LIVE':present?'PARTIAL':'WAITING';pill.className='pill '+(present===4?'buy':'wait');
  el('agentCouncilNote').textContent=present===4?'Fundamental, Technical, Risk and Portfolio agents have all published. The Portfolio Manager verdict drives the final signal only after the Risk Manager passes it.':'The app will not invent agent opinions. Until the four-agent runner publishes its output, TradeDesk shows the existing signal only.';
}
function setBroker(name){
  if(!['EasyEquities','IBKR'].includes(name))return;
  data.preferredBroker=name;save();renderBroker();toast(`${name} selected for new trade hand-off`);
}
function renderBroker(){
  const b=data.preferredBroker||'EasyEquities';
  el('brokerPill').textContent=b==='IBKR'?'IBKR':'EASY EQUITIES';
  el('brokerEEBtn').className='broker-option '+(b==='EasyEquities'?'selected':'secondary');
  el('brokerIBKRBtn').className='broker-option '+(b==='IBKR'?'selected':'secondary');
  el('openBrokerBtn').textContent=b==='IBKR'?'Open IBKR':'Open EasyEquities';
  el('brokerNote').textContent=b==='IBKR'?'New tickets will open the official IBKR Client Portal with the ticker copied. Live API execution remains disabled until we prove the signal engine.':'Existing positions stay at EasyEquities. New tickets continue to open EasyEquities and still require your confirmation.';
}
