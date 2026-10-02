(() => {
  const BINANCE_HOME='https://www.binance.com/en/trade/';
  const BINANCE_API='https://api.binance.com/api/v3';
  const SYMBOLS=[
    {symbol:'BTCUSDT',ticker:'BTC',name:'Bitcoin'},
    {symbol:'ETHUSDT',ticker:'ETH',name:'Ethereum'},
    {symbol:'SOLUSDT',ticker:'SOL',name:'Solana'},
    {symbol:'BNBUSDT',ticker:'BNB',name:'BNB'},
    {symbol:'XRPUSDT',ticker:'XRP',name:'XRP'}
  ];
  let market={};

  function $id(id){return document.getElementById(id)}
  function usd(v){const n=Number(v);return Number.isFinite(n)?'$'+n.toLocaleString(undefined,{minimumFractionDigits:n>=100?2:4,maximumFractionDigits:n>=100?2:4}):'—'}
  function pct(v){const n=Number(v);return Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(2)+'%':'—'}

  function marketVerdict(row){
    const c=Number(row.priceChangePercent);
    if(!Number.isFinite(c)) return {label:'WAIT',cls:'wait',reason:'Market data unavailable'};
    if(c<=-4) return {label:'DEFENSIVE',cls:'avoid',reason:'24h momentum is sharply negative'};
    if(c<0) return {label:'HOLD',cls:'wait',reason:'Momentum is negative; avoid chasing'};
    if(c<=4) return {label:'WATCH',cls:'prepare',reason:'Positive momentum without an extreme 24h move'};
    if(c<=9) return {label:'STRONG',cls:'buy',reason:'Strong positive 24h momentum; confirm risk before entry'};
    return {label:'HOT',cls:'wait',reason:'Extended 24h move; avoid chasing'};
  }

  function render(){
    const host=$id('cryptoWatchlist'); if(!host) return;
    host.innerHTML=SYMBOLS.map(s=>{
      const r=market[s.symbol]||{}; const v=marketVerdict(r);
      return `<article class="crypto-row">
        <div><div class="ticker">${s.ticker}</div><div class="muted">${s.name}</div></div>
        <div><span>Price</span><strong>${usd(r.lastPrice)}</strong></div>
        <div><span>24h</span><strong class="${Number(r.priceChangePercent)>=0?'positive':'negative'}">${pct(r.priceChangePercent)}</strong></div>
        <div><span>24h volume</span><strong>${r.quoteVolume?usd(r.quoteVolume):'—'}</strong></div>
        <div class="crypto-signal"><span class="action ${v.cls}">${v.label}</span><small>${v.reason}</small></div>
        <div class="trade-pair">
          <button class="buy-btn" onclick="openBinancePair('${s.symbol}')">TRADE</button>
          <button class="secondary" onclick="copyText('${s.ticker}')">COPY</button>
        </div>
      </article>`;
    }).join('');
  }

  async function refresh(manual=false){
    const pill=$id('binanceStatusPill');
    if(pill){pill.textContent='UPDATING';pill.className='pill wait'}
    try{
      const res=await fetch(BINANCE_API+'/ticker/24hr',{cache:'no-store'});
      if(!res.ok) throw new Error('Binance market data unavailable');
      const rows=await res.json();
      const wanted=new Set(SYMBOLS.map(x=>x.symbol));
      market=Object.fromEntries(rows.filter(x=>wanted.has(x.symbol)).map(x=>[x.symbol,x]));
      render();
      const tm=$id('binanceRefreshTime'); if(tm) tm.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      if(pill){pill.textContent='LIVE';pill.className='pill buy'}
      if(manual && window.toast) toast('Binance market refreshed');
    }catch(e){
      if(pill){pill.textContent='OFFLINE';pill.className='pill wait'}
      if(manual && window.toast) toast('Binance market refresh failed');
    }
  }

  window.openBinancePair=(symbol)=>{
    const pair=String(symbol||'BTCUSDT').replace('USDT','_USDT');
    window.open(BINANCE_HOME+pair,'_blank','noopener');
  };
  window.openBinance=()=>window.open('https://www.binance.com/en/my/wallet/account/main','_blank','noopener');
  window.refreshBinanceMarket=refresh;

  const oldSetBroker=window.setBroker;
  window.setBroker=function(name){
    if(name!=='Binance') return oldSetBroker(name);
    data.preferredBroker='Binance'; save(); renderBroker(); if(window.toast) toast('Binance selected for crypto trade hand-off');
  };

  const oldRenderBroker=window.renderBroker;
  window.renderBroker=function(){
    const b=data.preferredBroker||'EasyEquities';
    if(b!=='Binance') {
      oldRenderBroker();
      const bb=$id('brokerBinanceBtn'); if(bb) bb.className='broker-option secondary';
      return;
    }
    const pill=$id('brokerPill'); if(pill) pill.textContent='BINANCE';
    const ee=$id('brokerEEBtn'); if(ee) ee.className='broker-option secondary';
    const ib=$id('brokerIBKRBtn'); if(ib) ib.className='broker-option secondary';
    const bn=$id('brokerBinanceBtn'); if(bn) bn.className='broker-option selected';
    const ob=$id('openBrokerBtn'); if(ob) ob.textContent='Open Binance';
    const note=$id('brokerNote'); if(note) note.textContent='Crypto trade tickets open Binance. TradeDesk monitors the market automatically, but every live order still requires your approval.';
  };

  const oldOpenPortfolio=window.openPortfolio;
  window.openPortfolio=function(){
    if((data.preferredBroker||'')==='Binance') return openBinance();
    return oldOpenPortfolio();
  };

  if(!data.preferredBroker || data.preferredBroker==='EasyEquities') {
    data.preferredBroker='Binance'; save();
  }
  renderBroker();
  refresh(false);
  setInterval(()=>refresh(false),60*1000);
})();