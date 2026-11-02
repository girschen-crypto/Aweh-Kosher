/* Mr G TradeDesk Futures Signal Lab — offline paper trading ONLY.
   No API keys, order submission, exchange connection or price service. */
(()=>{
"use strict";
const $=id=>document.getElementById(id), num=id=>Number($(id).value);
const money=v=>Number.isFinite(v)?v.toFixed(2)+" USDT":"—";
const fixed=v=>Number.isFinite(v)?v.toFixed(4):"—";
const put=(id,value)=>$(id).textContent=String(value);
const STORAGE="mrgTradeDeskFuturesLabV1";
const fresh=()=>({cash:200,reserve:0,realised:0,position:null,history:[]});
let account=fresh(),plan=null;
try{
  const o=JSON.parse(localStorage.getItem(STORAGE)||"null");
  if(o&&Number.isFinite(o.cash)&&o.cash>=0&&Number.isFinite(o.reserve)&&o.reserve>=0&&Number.isFinite(o.realised)&&Array.isArray(o.history)&&o.history.length<=100&&(!o.position||(o.position.margin>0&&o.position.entry>0&&o.position.exposure>0)))account=o;
}catch(_){}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(account));}catch(_){}}
function message(t){put("message",t);}
function parseSignal(){
  const s=$("signal").value;
  const pair=s.match(/(?:Futures|Contract)\s*:\s*([A-Z0-9]{2,12})\s*\/\s*(USDT|USDC)/i);
  const lev=s.match(/Leverage\s*:\s*(\d+(?:\.\d+)?)\s*[x×]?/i);
  const size=s.match(/Position\s*Size\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
  const direction=s.match(/Direction\s*:\s*([^\n\r]+)/i);
  const market=/Order\s*Type\s*:\s*Market\s*Order/i.test(s);
  if(!pair||!lev||!size||!direction||!market){
    put("parsed","Unrecognised or incomplete signal. Required: Futures pair, Leverage, Market Order, Position Size and LONG/SHORT direction.");return;
  }
  const dir=direction[1].toUpperCase().includes("LONG")?"LONG":direction[1].toUpperCase().includes("SHORT")?"SHORT":null;
  if(!dir){put("parsed","The direction must say LONG or SHORT. Nothing was traded.");return;}
  $("pair").value=pair[1].toUpperCase()+"/"+pair[2].toUpperCase();
  $("leverage").value=Number(lev[1]);$("percent").value=Number(size[1]);$("direction").value=dir;
  put("parsed",$("pair").value+" | "+dir+" | "+lev[1]+"× | "+size[1]+"% | Market Order. A stop, target and fill price were NOT provided.");
  calculate();
}
function valid(){
  const balance=num("balance"), pct=num("percent"), lev=num("leverage"),
        perunit=num("perunit"),entry=num("entry"),fee=num("fee");
  const pair=$("pair").value.trim().toUpperCase(),direction=$("direction").value;
  const stop=$("stop").value.trim()===""?null:num("stop");
  const target=$("target").value.trim()===""?null:num("target");
  if(!(Number.isFinite(balance)&&balance>0&&pct>0&&pct<=100&&Number.isInteger(lev)&&lev>=1&&lev<=125&&Number.isFinite(perunit)&&perunit>0&&Number.isFinite(entry)&&entry>0&&Number.isFinite(fee)&&fee>=0&&
    /^[A-Z0-9]{2,12}\/(USDT|USDC)$/.test(pair)&&
    (direction==="LONG"||direction==="SHORT")&&
    (stop===null||(stop>0&&stop<100))&&(target===null||(target>0&&target<=1000)))){
    return null;
  }
  const requested=balance*pct/100;
  const contracts=Math.floor((requested+1e-9)/perunit);
  if(contracts<1)return {error:"Allocation is too small to buy one whole contract under the assumed contract rules."};
  const margin=contracts*perunit,notional=margin*lev,fees=2*contracts*fee;
  return {balance,percent:pct,leverage:lev,perunit,entry,fee,pair,direction,stop,target,requested,contracts,margin,notional,fees};
}
function calculate(){
  plan=null;$("open").disabled=true;
  const v=valid();
  if(!v||v.error){
    ["requested","contracts","margin","notional","fees","favourable","adverse","breakEven"].forEach(id=>put(id,"—"));
    message(v&&v.error||"Invalid numbers or symbol. Check balance, allocation, whole-number leverage, unit margin, entry and fees.");
    return;
  }
  plan=v;
  put("requested",money(v.requested));put("contracts",v.contracts);
  put("margin",money(v.margin));put("notional",money(v.notional));put("fees",money(v.fees));
  put("favourable",money(.005*v.notional-v.fees));
  put("adverse",money(-.005*v.notional-v.fees));
  put("breakEven",fixed(100*v.fees/v.notional)+"% price movement");
  const warnings=[];
  if(v.leverage>=20)warnings.push("HIGH RISK: "+v.leverage+"× can exhaust the margin after roughly "+fixed(100/v.leverage)+"% adverse movement, and actual liquidation may happen sooner.");
  if(v.stop===null)warnings.push("No stop-loss specified in this signal.");
  if(v.target===null)warnings.push("No take-profit specified.");
  if(v.margin>account.cash+1e-7)warnings.push("The example order exceeds the available virtual cash.");
  if(account.position)warnings.push("A virtual position is already open.");
  if(Math.abs(v.balance-account.cash)>.001)warnings.push("Sizing balance differs from available free virtual cash.");
  put("risk",warnings.length?warnings.join(" "):"Parameters are arithmetically valid; market risk remains.");
  $("risk").className=warnings.length?"notice":"notice good";
  $("open").disabled=!!account.position||v.margin>account.cash+1e-7;
  message("Calculated using user-supplied example assumptions. No actual order has been placed.");
}
function gross(p,price){
  return p.notional*(price/p.entry-1)*(p.direction==="LONG"?1:-1);
}
function net(p,price){return gross(p,price)-2*p.contracts*p.fee;}
function settlement(reason,price){
  const p=account.position;
  if(!p)return;
  const pnl=Math.max(-p.margin,net(p,price));
  account.cash+=p.margin+Math.min(0,pnl);
  account.reserve+=Math.max(0,pnl);
  account.realised+=pnl;
  account.history.unshift({date:new Date().toISOString(),pair:p.pair,direction:p.direction,contracts:p.contracts,pnl,reason});
  account.history=account.history.slice(0,100);
  account.position=null;
  persist();render();calculate();
  message("Virtual position closed: "+money(pnl)+" net ("+reason+"). Positive paper profits are only recorded in the virtual reserve.");
}
function render(){
  put("cash",money(account.cash));
  put("locked",money(account.position?account.position.margin:0));
  put("reserve",money(account.reserve));
  put("realised",money(account.realised));
  $("check").disabled=!account.position;
  $("close").disabled=!account.position;
  if(account.position){
    const p=account.position;
    put("position",p.pair+" "+p.direction+" | "+p.contracts+" contract(s) | "+p.leverage+"× | entry "+fixed(p.entry)+" | margin "+money(p.margin)+" | stop "+(p.stop===null?"NONE":p.stop+"%")+" | target "+(p.target===null?"NONE":p.target+"%"));
    const m=num("mark");
    put("unrealised",m>0?money(Math.max(-p.margin,net(p,m)))+" at manually entered price":"Enter a valid mark price");
  }else{
    put("position","No open virtual position.");
    put("unrealised","No open virtual position");
  }
  const body=$("history");body.replaceChildren();
  if(!account.history.length){
    const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=6;td.textContent="No completed virtual trades.";tr.append(td);body.append(tr);
  }else{
    account.history.slice(0,20).forEach(h=>{
      const tr=document.createElement("tr");
      [new Date(h.date).toLocaleString(),h.pair,h.direction,h.contracts,money(h.pnl),h.reason].forEach(value=>{
        const td=document.createElement("td");td.textContent=String(value);tr.append(td);
      });body.append(tr);
    });
  }
}
$("parse").addEventListener("click",parseSignal);
$("twenty").addEventListener("click",()=>{
  const t=$("signal");t.value=t.value.replace(/Position\s*Size\s*:\s*\d+(?:\.\d+)?\s*%/i,"Position Size: 20%");parseSignal();
});
$("calculate").addEventListener("click",calculate);
$("open").addEventListener("click",()=>{
  calculate();
  if(!plan||account.position||plan.margin>account.cash+1e-7)return;
  account.cash-=plan.margin;
  account.position=Object.assign({},plan,{opened:new Date().toISOString()});
  persist();render();calculate();
  message("Opened a virtual paper position at the example price. No broker transaction happened.");
});
$("mark").addEventListener("input",render);
$("check").addEventListener("click",()=>{
  const p=account.position,price=num("mark");
  if(!p||!(price>0))return message("Please enter a positive, manually observed price.");
  const change=100*(price/p.entry-1)*(p.direction==="LONG"?1:-1);
  if(net(p,price)<=-p.margin)return settlement("SIMULATED MARGIN EXHAUSTION, NOT ACTUAL EXCHANGE LIQUIDATION",price);
  if(p.stop!==null&&change<=-p.stop)return settlement("MANUAL STOP CHECK",price);
  if(p.target!==null&&change>=p.target)return settlement("MANUAL TARGET CHECK",price);
  render();message("Price checked manually. No stop or target triggered; there is no live monitoring.");
});
$("close").addEventListener("click",()=>{
  if(!account.position)return;
  const price=num("mark");
  if(!(price>0))return message("Enter a valid manual price to close the virtual position.");
  settlement("MANUAL EXIT",price);
});
$("reset").addEventListener("click",()=>{
  if(!confirm("Reset fictional cash to 200 USDT and clear the local paper-trading history?"))return;
  account=fresh();persist();render();calculate();message("Virtual account reset. No real funds were touched.");
});
render();calculate();
})();
