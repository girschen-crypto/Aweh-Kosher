import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarket, normaliseCandles, emaSeries, rsi, atr, RULES, scanMarkets } from "../../netlify/functions/_shared/tradedesk-radar.mjs";
import { runSignalCycle } from "../../netlify/functions/tradedesk-signal-cycle.mjs";
import { handleSignals } from "../../netlify/functions/tradedesk-signals.mjs";
import { issueSession } from "../../netlify/functions/_shared/tradedesk-passkey-session.mjs";

const MIN=15*60000;
const origin="https://mrg-trade-desk.netlify.app";
const now=Date.parse("2026-11-05T12:08:00.000Z");
const start=Date.parse("2026-11-04T17:00:00.000Z");
const candle=(i,price,spread=0.001)=>({
  startTime:new Date(start+i*MIN).toISOString(),open:String(price),close:String(price),
  high:String(price*(1+spread)),low:String(price*(1-spread)),
});
const series=(prices)=>prices.map((p,i)=>candle(i,p));
const store=()=>{
  const map=new Map();return {
    map,
    async get(key){return map.get(key)||null;},
    async setJSON(key,value){map.set(key,JSON.parse(JSON.stringify(value)));}
  };
};
function req(action="latest",path="/.netlify/functions/tradedesk-signals",headers={}){
  return new Request(origin+path,{method:"POST",
    headers:{"Origin":origin,"Content-Type":"application/json",...headers},
    body:JSON.stringify({action})});
}
async function json(resp){return {status:resp.status,...await resp.json()};}

test("The budget, leverage and per-trade loss policy remain fixed",()=>{
  assert.equal(RULES.budgetZar,200);
  assert.equal(RULES.riskZar,2);
  assert.equal(RULES.maxLeverage,2);
  assert.equal(RULES.maxMarginZar,40);
  assert.equal(RULES.candleSeconds,900);
});
test("Normalize VALR-like closed candles and remove unfinished candles",()=>{
  const raw=series(Array.from({length:60},(_,i)=>100+i*0.1));
  raw.push(candle(99,150));
  const n=normaliseCandles(raw,now);
  assert.ok(n.length>=45);
  assert.equal(n.length,60);
  assert.equal(n[0].close,100);
  assert.equal(n.at(-1).time,start+59*MIN);
  assert.equal(n.filter(x=>x.close===150).length,0);
});
test("Never issue a trade on stale, malformed or unverified candles",()=>{
  assert.equal(evaluateMarket("BTCUSDTPERP",[],now).direction,"WAIT");
  assert.equal(evaluateMarket("ETTUSDTPERP",normaliseCandles(series(Array(60).fill(100)),now),now).direction,"WAIT");
  const flat=normaliseCandles(series(Array(60).fill(100)),now);
  const signal=evaluateMarket("BTCUSDTPERP",flat,now);
  assert.equal(signal.direction,"WAIT");
  assert.equal(signal.executable,false);
  assert.ok(signal.reason);
});
test("EMA, RSI and ATR calculate finite values on a valid sequence",()=>{
  const values=Array.from({length:60},(_,i)=>100+i*0.3);
  const n=normaliseCandles(series(values),now);
  assert.ok(emaSeries(values,9).every((v,i)=>i<8?v===null:Number.isFinite(v)));
  assert.ok(Number.isFinite(rsi(values)));
  assert.ok(Number.isFinite(atr(n)));
});
test("No unsupported contract or synthetic spot quote is promoted to a futures signal",async()=>{
  const fetchFn=async url=>{
    if(url.endsWith("/futures/info"))return {ok:true,json:async()=>[{currencyPair:"BTCUSDTPERP"}]};
    return {ok:false,status:404,json:async()=>({})};
  };
  const snapshot=await scanMarkets({fetchFn,now});
  assert.equal(snapshot.results.length,4);
  assert.equal(snapshot.newSignalCount,0);
  assert.ok(snapshot.results.every(v=>v.direction==="WAIT"&&v.executable===false));
  assert.match(snapshot.results.find(x=>x.pair==="ETHUSDTPERP").reason,/Not verified/);
});
test("Market API outage fails closed without invented signals",async()=>{
  const snapshot=await scanMarkets({fetchFn:async()=>{throw Error("offline")},now});
  assert.equal(snapshot.newSignalCount,0);
  assert.equal(snapshot.results.length,0);
  assert.match(snapshot.error,/unavailable/);
});
test("Scheduled cycle stores latest status without any broker order calls",async()=>{
  const saved=store();
  const urls=[];
  const fetchFn=async url=>{
    urls.push(String(url));
    if(String(url).endsWith("/futures/info"))return {ok:true,json:async()=>[{currencyPair:"BTCUSDTPERP"}]};
    return {ok:true,json:async()=>series(Array(60).fill(100))};
  };
  const output=await runSignalCycle({store:saved,fetchFn,now});
  assert.equal(output.newEvents,0);
  assert.equal(output.markets,4);
  assert.ok(urls.every(u=>u.startsWith("https://api.valr.com/v1/public/")));
  const snapshot=saved.map.get("snapshot");
  assert.equal(snapshot.budgetZar,200);
  assert.equal(snapshot.history.length,0);
});
test("Latest public signal snapshot can be viewed without knowing the VALR owner password",async()=>{
  const saved=store();
  saved.map.set("snapshot",{scannedAt:new Date(now).toISOString(),results:[
    {pair:"BTCUSDTPERP",direction:"WAIT",executable:false,reason:"No crossover"}]});
  const response=await json(await handleSignals(req("latest"),{},saved,()=>{throw Error("No market calls")},()=>now));
  assert.equal(response.status,200);
  assert.equal(response.snapshot.results[0].direction,"WAIT");
});
test("Unauthenticated manual scan cannot trigger VALR calls",async()=>{
  const saved=store();const out=await json(await handleSignals(req("scan"),{},saved,
    ()=>{throw Error("No market calls")},()=>now));
  assert.equal(out.status,401);
  assert.equal(out.error,"SIGN_IN_REQUIRED");
});
test("Gaps anywhere in indicator history and conflicting duplicate candles fail closed",()=>{
  const n=normaliseCandles(series(Array(60).fill(100)),now);
  n.splice(20,1);
  assert.match(evaluateMarket("BTCUSDTPERP",n,now).reason,/discontinuous/);
  const raw=series(Array(60).fill(100));raw.push(candle(20,101));
  assert.deepEqual(normaliseCandles(raw,now),[]);
});
test("Stale snapshots retain history but cannot expose an old actionable direction",async()=>{
  for(const scannedAt of [new Date(now-21*60000).toISOString(),"bad-date",new Date(now+120000).toISOString()]){
    const saved=store();
    saved.map.set("snapshot",{scannedAt,history:[{direction:"SHORT",entry:100}],
      results:[{pair:"BTCUSDTPERP",direction:"LONG",entry:100,stop:99,target:102}]});
    const out=await json(await handleSignals(req(),{},saved,()=>{throw Error("No market call");},()=>now));
    assert.equal(out.status,200);assert.equal(out.snapshot.stale,true);
    assert.equal(out.snapshot.results[0].direction,"WAIT");
    assert.equal(out.snapshot.results[0].entry,null);
    assert.equal(out.snapshot.history.length,1);
    assert.equal(saved.map.get("snapshot").results[0].direction,"LONG");
  }
});
test("A valid passkey cookie can scan without a password; cooldown prevents repeated upstream calls",async()=>{
  const env={TRADEDESK_OWNER_TOKEN:"Z".repeat(48)},saved=store();
  const cookie=issueSession(env).split(";")[0];let calls=0;
  const fetchFn=async url=>{calls++;return {ok:true,json:async()=>String(url).endsWith("/futures/info")?
    [{currencyPair:"BTCUSDTPERP"}]:series(Array(60).fill(100))};};
  const request=()=>req("scan",undefined,{Cookie:cookie});
  const first=await json(await handleSignals(request(),env,saved,fetchFn,()=>now));
  assert.equal(first.status,200);assert.equal(calls,2);
  const second=await json(await handleSignals(request(),env,saved,fetchFn,()=>now+60000));
  assert.equal(second.status,200);assert.equal(calls,2);
});
