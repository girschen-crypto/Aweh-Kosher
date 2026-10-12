/* TradeDesk unattended paper cycle viewer. Read-only; no broker credentials. */
(() => {
  "use strict";
  const FEED = "https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/tradedesk-radar-data/trade-desk/auto-cycle-state.json";
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? "").replace(/[&<>"']/g,
      c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const asMoney = n => Number.isFinite(Number(n)) ?
      Number(n).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  const asPrice = n => Number.isFinite(Number(n)) ? "$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:8}) : "—";
  const when = value => { const t = new Date(value||""); return Number.isFinite(t.getTime()) ? t.toLocaleString("en-ZA",{dateStyle:"medium",timeStyle:"short"}) : "—"; };
  let busy = false;

  function render(s){
    if(s.mode !== "PAPER" || s.live_execution_enabled !== false ||
       s.withdrawals_enabled !== false || s.funding_source !== "VIRTUAL_ONLY"){
      throw Error("Unsafe state format; refusing to display a live trading claim");
    }
    const t = new Date(s.last_checked_at||"");
    const stale = !Number.isFinite(t.getTime()) || Date.now()-t.getTime()>20*60*1000;
    $("cycleStatusPill").textContent = stale ? "STALE / VERIFY" : "PAPER RUNNING";
    $("cycleStatusPill").className = "pill "+(stale?"wait":"buy");
    $("cycleUpdateTime").textContent = "Last simulated cycle: "+when(s.last_checked_at);
    $("cycleCash").textContent = asMoney(s.trading_cash_usdt);
    $("cycleReserve").textContent = asMoney(s.profit_reserve_usdt);
    $("cycleOpen").textContent = String((s.positions||[]).length);
    const trades = Array.isArray(s.closed_trades) ? s.closed_trades : [];
    const pnl = trades.reduce((sum,trade) => sum + (Number(trade.pnl_usdt)||0),0);
    $("cycleNetPnl").textContent = asMoney(pnl);
    $("cycleNetPnl").className = pnl>=0 ? "positive":"negative";
    $("cycleSummary").textContent = (stale?"The runner may be delayed or offline. ":"")+
        (s.last_status||"Waiting for a qualifying setup")+
        ". No real money or broker orders are involved.";
    const positions = Array.isArray(s.positions)?s.positions:[];
    const host = $("cyclePositions");
    host.innerHTML = positions.length ? positions.map(p =>
      '<article class="cycle-position"><div><strong>'+safe(p.pair)+'</strong><span> OPEN · VIRTUAL</span></div>'+
      '<div>Cost '+asMoney(p.cost_usdt)+' · Entry '+asPrice(p.entry_price_usdt)+'</div>'+
      '<div>Take profit '+asPrice(p.take_profit_usdt)+' · Stop loss '+asPrice(p.stop_loss_usdt)+'</div>'+
      '<small>Opened '+safe(when(p.opened_at))+' · Expires '+safe(when(p.expires_at))+'</small></article>'
    ).join("") : '<p class="cycle-muted">No open virtual positions. The system keeps cash until a quality-filtered signal appears.</p>';
    const recent = trades.slice(-5).reverse();
    $("cycleHistory").innerHTML = recent.length ? recent.map(p=>{
      const win = Number(p.pnl_usdt)>0;
      return '<article class="cycle-trade"><strong>'+safe(p.pair)+'</strong>'+
        '<span>'+safe(p.exit_reason||"EXIT")+'</span>'+
        '<strong class="'+(win?"positive":"negative")+'">'+(win?"+":"")+asMoney(p.pnl_usdt)+'</strong></article>';
    }).join(""):'<p class="cycle-muted">No completed virtual trades yet.</p>';
  }

  async function refreshAutoCycle(manual=false){
    if(busy || !$("cycleStatusPill"))return;
    busy=true;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(()=>ctl.abort(),10000);
      let response;
      try { response=await fetch(FEED+"?t="+Date.now(),{cache:"no-store",signal:ctl.signal}); }
      finally {clearTimeout(timer);}
      if(!response.ok)throw Error("Published cycle not found");
      render(await response.json());
      if(manual && window.toast) window.toast("Paper-cycle ledger refreshed");
    } catch(e){
      $("cycleStatusPill").textContent="NOT VERIFIED";
      $("cycleStatusPill").className="pill wait";
      $("cycleUpdateTime").textContent="No verified runner update";
      $("cycleSummary").textContent="Paper automation has not published a valid update. Real orders remain disabled.";
      if(manual && window.toast)window.toast("Cycle status unavailable");
    } finally {busy=false;}
  }
  window.refreshAutoCycle=refreshAutoCycle;
  refreshAutoCycle(false);
  setInterval(()=>refreshAutoCycle(false),60000);
})();