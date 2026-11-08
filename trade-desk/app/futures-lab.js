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
let account=fresh(),plan=null,parsedBlocked=false;
try{
  const o=JSON.parse(localStorage.getItem(STORAGE)||"null");
  if(o&&Number.isFinite(o.cash)&&o.cash>=0&&Number.isFinite(o.reserve)&&o.reserve>=0&&Number.isFinite(o.realised)&&Array.isArray(o.history)&&o.history.length<=100&&(!o.position||(o.position.margin>0&&o.position.entry>0&&o.position.exposure>0)))account=o;
}catch(_){}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(account));}catch(_){}}
function message(t){put("message",t);}
function parseSignal(){
  const s=$("signal").value;
  const fail=reason=>{
    parsedBlocked=true;plan=null;$("open").disabled=true;
    put("parsed",reason+" No position was opened.");
    message("Rejected external signal. Correct or verify the source before any virtual simulation.");
  };
  // Closing notices are not new entries, and cannot prove an exchange fill.
  if(/Take Profit Signals|position[ -]?closing notice|Close\s+(?:Long|Short|Position)/i.test(s))
    return fail("Closing notice, not a new entry signal.");
  const pairDeclarations=[...s.matchAll(/\b(?:Futures?|Contract)\s*:\s*([A-Z0-9]{2,12})\s*\/\s*(USDT|USDC)\b/gi)]
    .map(m=>(m[1]+"/"+m[2]).toUpperCase());
  const headerDeclarations=[...s.matchAll(/trading pair for this round is\s+([A-Z0-9]{2,12})\s*\/\s*(USDT|USDC)\b/gi)]
    .map(m=>(m[1]+"/"+m[2]).toUpperCase());
  const symbols=[...new Set([...pairDeclarations,...headerDeclarations])];
  if(symbols.length>1)return fail("Conflicting trading pairs appear in this message: "+symbols.join(" vs ")+".");
  const lev=s.match(/Leverage\s*:\s*(\d+(?:\.\d+)?)\s*[x×]?/i);
  const size=s.match(/Position\s*Size\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
  const direction=s.match(/\bDirection\s*:\s*([^\n\r]+)/i);
  const market=/Order\s*Type\s*:\s*Market\s*Order/i.test(s);
  if(symbols.length!==1||!lev||!size||!direction||!market)
    return fail("Unrecognised or incomplete entry signal. Pair, leverage, allocation, Market Order and direction are required.");
  const line=direction[1].toUpperCase();
  const dirs=[...new Set([...line.matchAll(/\b(LONG|SHORT)\b/g)].map(m=>m[1]))];
  if(dirs.length!==1)return fail("Missing or conflicting LONG/SHORT direction.");
  const dir=dirs[0];
  const headerDirection=s.match(/with a\s+(?:Buy|Sell)\s*\/\s*(Long|Short)\s+position/i);
  if(headerDirection&&headerDirection[1].toUpperCase()!==dir)
    return fail("The announcement direction conflicts with the instruction direction.");
  const verb=direction[1].match(/\b(Buy|Sell)\s*\/\s*(Long|Short)\b/i);
  if(verb&&((verb[1].toUpperCase()==="BUY"&&dir!=="LONG")||
    (verb[1].toUpperCase()==="SELL"&&dir!=="SHORT")))
    return fail("The order verb conflicts with LONG/SHORT direction.");
  parsedBlocked=false;
  $("pair").value=symbols[0];$("leverage").value=Number(lev[1]);
  $("percent").value=Number(size[1]);$("direction").value=dir;
  put("parsed",symbols[0]+" | "+dir+" | "+lev[1]+"× | "+size[1]+"% | Market Order. Historical, unverified source; no entry, stop, target or exchange fill confirmed.");
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
  if(parsedBlocked)warnings.push("Signal text was rejected; interpret a valid entry before opening a virtual position.");
  if(account.position)warnings.push("A virtual position is already open.");
  if(Math.abs(v.balance-account.cash)>.001)warnings.push("Sizing balance differs from available free virtual cash.");
  put("risk",warnings.length?warnings.join(" "):"Parameters are arithmetically valid; market risk remains.");
  $("risk").className=warnings.length?"notice":"notice good";
  $("open").disabled=parsedBlocked||!!account.position||v.margin>account.cash+1e-7;
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
$("signal").addEventListener("input",()=>{parsedBlocked=true;plan=null;$("open").disabled=true;put("parsed","Signal text changed. Interpret the new text before any virtual trade.");});
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
