import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const code=readFileSync(new URL("../app/tradedesk-signals.js",import.meta.url),"utf8");
const fresh={scannedAt:new Date().toISOString(),results:[{pair:"BTCUSDTPERP",direction:"LONG",entry:100,stop:99,target:102}],
  history:[{pair:"ETHUSDTPERP",direction:"SHORT",at:new Date().toISOString(),entry:200}]};
async function harness(snapshot=fresh,origin="https://mrg-trade-desk.netlify.app"){
  const elements=new Map(),intervals=[],listeners={};let at=Date.now(),failure=false;
  function element(){return {children:[],textContent:"",value:"",disabled:false,
    append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},
    addEventListener(name,fn){this[name]=fn;}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  class Clock extends Date{static now(){return at;}}
  const document={getElementById:get,createElement:element,addEventListener(name,fn){listeners[name]=fn;}};
  vm.runInNewContext(code,{document,window:{location:{origin},addEventListener(name,fn){listeners[name]=fn;}},Date:Clock,
    setInterval(fn,ms){intervals.push({fn,ms});},AbortSignal,
    fetch:async()=>{if(failure)throw Error("offline");return {ok:true,json:async()=>({ok:true,initialized:true,snapshot})};}});
  await new Promise(setImmediate);
  const text=e=>e.textContent+e.children.map(text).join(" ");
  return {get,text,intervals,listeners,advance(ms){at+=ms;},fail(){failure=true;}};
}
test("Public dashboard expires a displayed signal without another successful request",async()=>{
  const h=await harness();assert.match(h.text(h.get("signalMarketList")),/LONG/);
  assert.match(h.get("signalLastScan").textContent,/SAST/);
  h.advance(21*60000);h.intervals.find(x=>x.ms===30000).fn();
  assert.doesNotMatch(h.text(h.get("signalMarketList")),/LONG|Reference 100/);
  assert.match(h.get("signalScanStatus").textContent,/out of date/);
});
test("Offline and failed refresh clear previously shown current signals",async()=>{
  const h=await harness();h.listeners.offline();
  assert.doesNotMatch(h.text(h.get("signalMarketList")),/LONG/);
  h.fail();await h.get("signalRefresh").click();
  assert.match(h.get("signalScanStatus").textContent,/Could not retrieve/);
});
test("An upstream outage replaces market rows and still refreshes historical records",async()=>{
  const h=await harness({...fresh,results:[],error:"VALR unavailable"});
  assert.match(h.text(h.get("signalMarketList")),/Waiting for a successful scan/);
  assert.match(h.text(h.get("signalEventList")),/ETH\/USDT-PERP SHORT/);
});
test("Previews clearly disable market requests and private credential entry",async()=>{
  const h=await harness(fresh,"https://deploy-preview-18--mrg-trade-desk.netlify.app");
  assert.equal(h.get("signalRefresh").disabled,true);assert.equal(h.get("signalScanNow").disabled,true);
  assert.match(h.get("signalScanStatus").textContent,/Preview only/);
  const client=readFileSync(new URL("../app/tradedesk-valr-client.js",import.meta.url),"utf8");
  vm.runInNewContext(client,{document:{getElementById:h.get},window:{location:{origin:"https://preview.example"}}});
  assert.equal(h.get("valrOwnerPassword").disabled,true);
  assert.equal(h.get("valrReadBalance").disabled,true);
  assert.match(h.get("valrPasskeyStatus").textContent,/Preview only/);
});
