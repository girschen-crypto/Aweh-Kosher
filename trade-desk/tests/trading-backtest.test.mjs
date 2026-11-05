import test from "node:test";
import assert from "node:assert/strict";
import { backtest } from "../scripts/backtest.mjs";
import { inputs } from "./trading-fixtures.mjs";
const start=Date.parse("2026-10-01T00:00:00Z"),step=900000;
function dataset(){
  const candles=Array.from({length:100},(_,i)=>({time:start+i*step,open:100,high:107,low:97,close:100}));
  const i=inputs();return {start:new Date(start).toISOString(),end:new Date(start+100*step).toISOString(),
    data:{BTCUSDTPERP:[],ETHUSDTPERP:[],SOLUSDTPERP:candles,XRPUSDTPERP:[],USDTZAR:candles.map(c=>({...c,open:16,high:16,low:16,close:16}))},
    funding:{SOLUSDTPERP:[]},proof:{markets:[{pair:"SOLUSDTPERP",spec:i.spec}]}};
}
const detector=(pair,history,now)=>{
  assert.ok(history.every(c=>c.time+900000<=now),"Only closed prior candles are visible to the detector");
  return {pair,direction:"LONG",entry:100,stop:98,time:new Date(history.at(-1).time+900000).toISOString()};
};
test("Historical simulation uses prior candles, rejects same-bar overlapping entries and stops first when both levels touch",()=>{
  const d=dataset(),r=backtest(d,{detector});assert.ok(r.journal.length>0);
  assert.ok(r.journal.every(t=>t.reason==="STOP"));
  for(let i=1;i<r.journal.length;i++)assert.ok(Date.parse(r.journal[i].openedAt)>=Date.parse(r.journal[i-1].closedAt));
  assert.equal(r.halt,"CONSECUTIVE_LOSS_LIMIT");assert.ok(Number(r.costsZar)>0);
});
test("Changing future data cannot change trades before that data is observed",()=>{
  const original=dataset(),changed=structuredClone(original);changed.data.SOLUSDTPERP.slice(80).forEach(c=>{c.open=10000;c.high=11000;c.low=9000;c.close=10000;});
  assert.deepEqual(backtest(original,{detector}),backtest(changed,{detector}));
});
