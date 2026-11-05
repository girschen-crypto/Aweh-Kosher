// No external packages. Run: node trade-desk/tests/futures-lab.test.cjs
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const code=fs.readFileSync(path.join(__dirname,"../app/futures-lab.js"),"utf8");
const defaults={balance:"200",percent:"10",leverage:"100",perunit:"10",pair:"ETT/USDT",direction:"LONG",entry:"47.8673",fee:".25",stop:"",target:"",mark:"47.9657",signal:"Futures: ETT / USDT\nLeverage: 100X\nOrder Type: Market Order\nPosition Size: 10%\nDirection: Buy / LONG"};
function harness(overrides={}){
  const els={},stored={};const vals={...defaults,...overrides};
  const get=id=>els[id]||(els[id]={
    value:vals[id]??"",textContent:"",disabled:false,className:"",handlers:{},
    addEventListener(evt,fn){this.handlers[evt]=fn;},replaceChildren(){this.children=[];},
    append(child){(this.children||(this.children=[])).push(child);}
  });
  const doc={getElementById:get,createElement:tag=>({tag,children:[],append(child){this.children.push(child);}})};
  const storage={getItem:key=>stored[key]||null,setItem:(key,v)=>stored[key]=v};
  vm.runInNewContext(code,{document:doc,localStorage:storage,confirm:()=>true,Date,Number,String,Math,Array,JSON,RegExp,console},{timeout:2000});
  const click=id=>{assert.equal(typeof get(id).handlers.click,"function",id+" has a click handler");get(id).handlers.click();};
  const state=()=>JSON.parse(stored.mrgTradeDeskFuturesLabV1||"null");
  return {get,click,state};
}
{
  const h=harness();
  h.click("parse");
  assert.match(h.get("parsed").textContent,/ETT\/USDT.*LONG.*100×.*10%/);
  assert.equal(h.get("contracts").textContent,"2");
  assert.equal(h.get("margin").textContent,"20.00 USDT");
  assert.equal(h.get("notional").textContent,"2000.00 USDT");
  assert.equal(h.get("fees").textContent,"1.00 USDT");
  assert.equal(h.get("favourable").textContent,"9.00 USDT");
  assert.equal(h.get("adverse").textContent,"-11.00 USDT");
  h.click("open");
  assert.equal(h.state().cash,180);
  assert.equal(h.state().position.contracts,2);
  h.click("close");
  assert.equal(h.state().cash,200);
  assert.ok(h.state().reserve>0);
  assert.equal(h.state().history.length,1);
}
{
  const h=harness({percent:"20"});
  assert.equal(h.get("contracts").textContent,"4");
  assert.equal(h.get("margin").textContent,"40.00 USDT");
  assert.equal(h.get("notional").textContent,"4000.00 USDT");
}
{
  const h=harness({balance:"2000",percent:"10"});
  assert.equal(h.get("contracts").textContent,"20");
  assert.equal(h.get("margin").textContent,"200.00 USDT");
  assert.equal(h.get("notional").textContent,"20000.00 USDT");
  assert.equal(h.get("open").disabled,false); // exactly 200 virtual cash is free for 200 margin; example sizing is hypothetical
}
{
  const h=harness({direction:"SHORT",mark:"49"});
  h.click("open");h.click("check");
  assert.equal(h.state().position,null);
  assert.equal(h.state().history[0].pnl,-20);
  assert.match(h.state().history[0].reason,/MARGIN EXHAUSTION/);
}
{
  const h=harness({direction:"LONG",mark:"48.4",stop:".5",target:".8"});
  h.click("open");h.click("check");
  assert.equal(h.state().position,null);
  assert.match(h.state().history[0].reason,/TARGET/);
}
{
  const h=harness();
  h.get("signal").value="Contract: CLS/USDT\nLeverage: 50X\nOrder Type: Market Order\nPosition Size: 20%\nDirection: Sell / SHORT";
  h.click("parse");
  assert.equal(h.get("direction").value,"SHORT");
  assert.equal(Number(h.get("leverage").value),50);
  assert.equal(Number(h.get("percent").value),20);
}
{
  const h=harness({fee:"1e999"});
  assert.equal(h.get("open").disabled,true); // reject Infinity
}
// Home page and service worker must expose no unrelated investment choices.
{
  const home=fs.readFileSync(path.join(__dirname,"../app/index.html"),"utf8");
  const sw=fs.readFileSync(path.join(__dirname,"../app/sw.js"),"utf8");
  assert.match(home,/Futures Trading Signals/);
  assert.match(home,/id="signal"/);
  assert.match(home,/futures-lab\.js/);
  assert.doesNotMatch(home,/binance\.js|radar\.js|auto-cycle\.js|app\.js\?v=/i);
  assert.doesNotMatch(home,/EasyEquities|IBKR|BWXT|Opportunity Radar|US WATCHLIST|Mining watchlist/i);
  assert.match(sw,/mrg-tradedesk-signals-v10/);
  assert.doesNotMatch(sw,/radar\.js|auto-cycle\.js|binance\.js/);
}
console.log("Futures Signal Lab: all regression checks and signal-only home checks passed.");
