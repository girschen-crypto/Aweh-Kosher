/* TradeDesk own-market signal dashboard. No money movement, no broker orders. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const endpoint="/.netlify/functions/tradedesk-signals";
const state={loading:false};
function value(id,v){$(id).textContent=String(v);}
function place(tag,cl,text){
  const e=document.createElement(tag);if(cl)e.className=cl;e.textContent=String(text);return e;
}
function formatTime(t){
  const d=new Date(t);return Number.isFinite(d.getTime())?
    d.toLocaleString("en-ZA",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"Unknown";
}
function show(snapshot){
  value("signalLastScan",formatTime(snapshot.scannedAt));
  value("signalScanStatus",snapshot.error||
    ("Scanning every 15 minutes · "+(snapshot.newEvents||0)+" new signals saved on this cycle"));
  const board=$("signalMarketList");board.replaceChildren();
  if(!Array.isArray(snapshot.results)||!snapshot.results.length){
    board.append(place("p","status","No confirmed VALR futures data yet. No trading permitted."));return;
  }
  for(const m of snapshot.results){
    const row=place("div","signal-row","");
    const left=place("div","signal-detail","");
    left.append(place("strong","",m.pair?.replace("USDTPERP","/USDT-PERP")||"Unknown market"));
    left.append(place("small","",m.source||"Public VALR market data"));
    const right=place("div","signal-right","");
    const label=place("strong",m.direction==="LONG"?"signal-long":
      m.direction==="SHORT"?"signal-short":"signal-wait",
      m.direction==="LONG"?"LONG · PAPER":
        m.direction==="SHORT"?"SHORT · PAPER":"NO TRADE");
    right.append(label);
    right.append(place("small","",m.reason||"Waiting for verified data"));
    if(m.entry)right.append(place("small","",
      "Reference "+m.entry+" USDT · RSI "+(m.indicators?.rsi14??"n/a")));
    if(m.direction!=="WAIT" && m.stop && m.target)right.append(place("small","",
      "Indicative stop "+m.stop+" · target "+m.target+" (not live orders)"));
    row.append(left,right);board.append(row);
  }
  const history=$("signalEventList");history.replaceChildren();
  const entries=Array.isArray(snapshot.history)?snapshot.history:[];
  if(!entries.length)history.append(place("p","caption","No fresh crossover signals recorded yet. Waiting is a valid outcome."));
  for(const h of entries.slice(0,12)){
    const item=place("p","signal-event","");
    item.append(place("strong","",h.pair?.replace("USDTPERP","/USDT-PERP")+" "+h.direction));
    item.append(place("span","",formatTime(h.at)+" · Reference "+h.entry+" USDT · paper only"));
    history.append(item);
  }
}
async function call(action){
  if(state.loading)return;
  state.loading=true;$("signalScanNow").disabled=true;$("signalRefresh").disabled=true;
  value("signalScanStatus",action==="scan"?"Checking VALR mark-price candles...":"Reading latest recorded signals...");
  try{
    const passwordField=$("valrOwnerPassword");
    const token=action==="scan"?passwordField?.value.trim():"";
    if(action==="scan"&&passwordField)passwordField.value="";
    const response=await fetch(endpoint,{
      method:"POST",cache:"no-store",credentials:"same-origin",
      headers:{"Content-Type":"application/json",...(token?{"Authorization":"Bearer "+token}:{})},
      body:JSON.stringify({action}),signal:AbortSignal.timeout(28000),
    });
    const body=await response.json();
    if(!response.ok||!body.ok){
      if(body.error==="SIGN_IN_REQUIRED")
        value("signalScanStatus","To scan now, unlock TradeDesk with your fingerprint or enter your owner password. Scheduled scanning runs automatically without login.");
      else value("signalScanStatus","Signal feed temporarily unavailable ("+(body.error||"unknown")+"). No trading action.");
      return;
    }
    if(!body.initialized){
      value("signalScanStatus",body.message||"Waiting for the first scheduled scan.");return;
    }
    show(body.snapshot);
  }catch{value("signalScanStatus","Could not retrieve signals. No order was placed.");}
  finally{state.loading=false;$("signalScanNow").disabled=false;$("signalRefresh").disabled=false;}
}
$("signalRefresh").addEventListener("click",()=>call("latest"));
$("signalScanNow").addEventListener("click",()=>call("scan"));
call("latest");
setInterval(()=>{if(!document.hidden)call("latest");},120000);
})();
