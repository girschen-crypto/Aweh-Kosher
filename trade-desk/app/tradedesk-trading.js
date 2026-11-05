(()=>{
"use strict";
const $=id=>document.getElementById(id);
const set=(id,v)=>{$(id).textContent=String(v);};
let authGeneration=0;
if(window.location.origin!=="https://mrg-trade-desk.netlify.app"){
  set("tradingStatus","Preview only. Trading controls are available on the live site.");
  set("tradingStorage","Preview · no order journal connection");set("tradingCredentials","Preview · private account access disabled");
  $("tradingRefresh").disabled=true;$("tradingStop").disabled=true;report();return;
}
async function call(action,manual=false){
  const field=$("valrOwnerPassword"),password=manual?field.value.trim():"";if(manual)field.value="";
  const response=await fetch("/.netlify/functions/tradedesk-trading",{method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json",...(password?{Authorization:"Bearer "+password}:{})},body:JSON.stringify({action}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"STATUS_UNAVAILABLE");return data;
}
async function publicStatus(){try{
  const s=await call("status");set("tradingMode",s.mode);set("tradingStatus",s.message);
  set("tradingStorage",s.journalHealthy?"Paper journal connected · live orders locked":s.databaseConfigured?"Journal connection unavailable · live orders locked":"Order database not configured · live activation blocked");
  const f=s.forward;
  set("tradingForward",f?.started_at?"Forward paper trial: "+f.observations+" recorded scans · started "+new Date(f.started_at).toLocaleString("en-ZA")+" · latest "+new Date(f.last_observed_at).toLocaleString("en-ZA")+(Date.now()-Date.parse(f.last_observed_at)>30*60000?" · OVERDUE":" · collecting every 15 minutes"):"Forward paper trial awaiting its first recorded scan.");
  set("tradingCredentials",s.separateTradeKeyConfigured?"Separate key configured; permissions need verification":"Read-only connection · no separate trade key configured");
}catch{set("tradingStatus","Trading status unavailable. Live activation is locked.");}}
function clearPrivate(){
  for(const id of ["tradingEquity","tradingNet","tradingTodayLoss","tradingTodayNet","tradingRecord"])set(id,"Not connected");
  set("tradingAccountReadiness","Private account readiness has not been checked.");set("tradingPosition","No reconciled exchange position available.");set("tradingProtection","No exchange-side protection confirmed.");$("tradingJournal").replaceChildren();
}
async function privateStatus(manual=false){const generation=authGeneration;try{
  const data=await call("journal",manual);if(generation!==authGeneration)return;
  set("tradingMode",data.mode);set("tradingStatus",data.stopped?"New entries stopped: "+data.stopReason:"Journal connected. "+data.mode+" mode.");
  const m=data.metrics;
  set("tradingEquity","R"+Number(m.equityZar).toFixed(2)+(data.mode==="PAPER"?" · simulated":" · journal"));
  set("tradingNet","R"+Number(m.totalNetZar).toFixed(2));set("tradingTodayLoss","R"+Number(m.dailyLossZar).toFixed(2));set("tradingTodayNet","R"+Number(m.dailyNetZar).toFixed(2));
  set("tradingRecord",m.wins+" wins · "+m.losses+" losses · "+m.trades+" closed");
  set("tradingPrivateStatus","Private journal refreshed. "+(data.mode==="PAPER"?"All amounts and positions below are simulated.":"Live journal."));
  const a=data.accountReadiness;set("tradingAccountReadiness",a?"Read-only account check "+new Date(a.observedAt).toLocaleString("en-ZA")+" · "+(a.readinessError||"Read checks passed; separate Trade key still required"):"Private account readiness has not been checked.");
  const t=data.active;set("tradingPosition",t?t.data.plan.pair+" "+t.data.plan.direction+" · "+t.data.plan.quantity+" · entry "+t.data.plan.entry+" USDT · "+t.state+
    (t.data.unrealisedPnlUsdt!==undefined?" · unrealised "+t.data.unrealisedPnlUsdt+" USDT":""):"No tracked open position");
  set("tradingProtection",t?.data.protectionVerified?"Exchange protection confirmed at last reconciliation · stop "+t.data.plan.stop+" · target "+t.data.plan.target+" USDT":"No exchange-side protection confirmed");
  $("tradingJournal").replaceChildren();
  for(const t of data.trades.slice(0,12)){const row=document.createElement("p");row.className="caption";
    row.textContent=t.mode+" · "+t.data.plan.pair+" "+t.data.plan.direction+" · "+t.state+(t.data.netZar!==undefined?" · net R"+Number(t.data.netZar).toFixed(2):"");$("tradingJournal").append(row);}
  for(const e of (data.events||[]).filter(e=>["SIGNAL_REJECTED","NO_TRADE","SUSPENDED"].includes(e.kind)).slice(0,8)){const row=document.createElement("p");row.className="caption";row.textContent=new Date(e.created_at).toLocaleString("en-ZA")+" · "+(e.data.pair||"")+" · "+e.kind+" · "+(e.data.reason||"");$("tradingJournal").append(row);}
}catch(e){if(generation!==authGeneration)return;if(e.message==="SIGN_IN_REQUIRED")clearPrivate();set("tradingPrivateStatus",e.message==="SIGN_IN_REQUIRED"?"Unlock with your passkey to view the private trading journal.":"Journal unavailable: "+e.message+". New live entries remain locked.");}}
async function report(){try{
  const r=await fetch("./trading-validation.json",{cache:"no-store"});if(!r.ok)throw Error();const d=await r.json();
  set("tradingEvidence",d.summary||"Validation incomplete. No claim of profitable trading.");
  const root=$("tradingCapitalTable");root.replaceChildren();
  for(const m of d.capitalAssessment||[]){const row=document.createElement("p");row.className="caption";
    row.textContent=m.pair.replace("USDTPERP","/USDT-PERP")+" · minimum "+m.quantity+" units · indicative 2× margin R"+m.marginZar+" · "+(m.fitsMarginCap?"within R40 margin cap; signal risk still required":"exceeds R40 margin cap");root.append(row);}
  const root2=$("tradingBacktest");root2.replaceChildren();
  for(const [label,metrics] of Object.entries(d.results||{})){const p=document.createElement("p");p.className="caption";
    p.textContent=label+": "+metrics.trades+" trades · win rate "+(metrics.winRate===null?"n/a":(metrics.winRate*100).toFixed(1)+"%")+
      " · net R"+metrics.netZar+" · max drawdown R"+metrics.maxDrawdownZar+" · modelled costs R"+metrics.costsZar;root2.append(p);}
}catch{set("tradingEvidence","Validation report unavailable. Live activation remains blocked.");}}
$("tradingRefresh").addEventListener("click",()=>privateStatus(true));
$("tradingStop").addEventListener("click",async()=>{try{await call("stop",true);set("tradingStatus","New entries stopped. Existing exchange protective orders preserved.");await privateStatus();}
  catch(e){set("tradingStatus","Stop request not confirmed: "+e.message+". Do not assume an active position is closed.");}});
publicStatus();report();
document.addEventListener("tradedesk-auth-change",event=>{authGeneration++;if(event.detail?.signedIn)privateStatus();else{clearPrivate();set("tradingPrivateStatus","Unlock with your passkey to view the private trading journal.");}});
})();
