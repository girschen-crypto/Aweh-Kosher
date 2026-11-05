import test from "node:test";
import assert from "node:assert/strict";
import { D,LIMITS,POLICY_HASH,buildPlan,lossGuard,capitalMinimum,daySast,orderKey } from "../../netlify/functions/_shared/tradedesk-trading-policy.mjs";
import { NOW,inputs } from "./trading-fixtures.mjs";
test("Fixed capital, loss, leverage and position limits cannot be changed by request input",()=>{
  assert.equal(LIMITS.capitalZar,200);assert.equal(LIMITS.riskZar,2);assert.equal(LIMITS.leverage,2);
  assert.equal(LIMITS.dailyLossZar,6);assert.equal(LIMITS.drawdownZar,20);assert.equal(LIMITS.consecutiveLosses,3);
  assert.ok(Object.isFrozen(LIMITS));assert.equal(POLICY_HASH.length,64);
});
test("A valid plan uses decimal contract rounding and includes cost reserves",()=>{
  const p=buildPlan(inputs());assert.equal(p.approved,true,p.reason);assert.equal(p.executable,false);
  assert.ok(D(p.quantity).mod(.01).eq(0));assert.ok(D(p.entry).mod(.01).eq(0));
  assert.ok(D(p.plannedRiskZar).lte(2));assert.ok(D(p.marginUsdt).mul(p.fxAsk).lte(40));
  assert.ok(D(p.netRewardRisk).gte(1.2));assert.ok(D(p.costReserveUsdt).gt(0));
});
test("Long and short have correctly oriented stop and target prices",()=>{
  const i=inputs();i.signal={...i.signal,direction:"SHORT",stop:102,target:94};const p=buildPlan(i);
  assert.equal(p.approved,true);assert.ok(D(p.stop).gt(p.entry));assert.ok(D(p.target).lt(p.entry));
});
test("Signals, FX and order books expire independently",()=>{
  for(const change of [i=>i.signal.time=new Date(NOW-21*60000).toISOString(),i=>i.fx.observedAt="bad",i=>i.book.changedAt=new Date(NOW-31000).toISOString(),i=>i.signal.time=new Date(NOW+60000).toISOString()]){
    const i=inputs();change(i);assert.equal(buildPlan(i).approved,false);
  }
});
test("Weak reward, excessive spread, insufficient depth and unknown costs are rejected",()=>{
  for(const change of [i=>i.book.bid="98",i=>i.book.askDepth="0.001",i=>i.feeRate=undefined,i=>i.fundingRate="0.001",i=>i.signal.stop=99.99]){
    const i=inputs();change(i);assert.equal(buildPlan(i).approved,false);
  }
});
test("R200 is never interpreted as 200 USDT and minimums are not rounded upward to fit",()=>{
  const i=inputs();i.spec.minBaseAmount="1";assert.equal(buildPlan(i).approved,false);
  const minimum=capitalMinimum(i.spec,"100","16");assert.equal(minimum.marginZar,"800.00");assert.equal(minimum.fitsMarginCap,false);
});
test("Remaining daily risk shrinks position size before the R6 limit is exhausted",()=>{
  const p=buildPlan(inputs({account:{dailyLossZar:"5.9"}}));
  assert.equal(p.approved,false); // minimum order cannot fit the remaining R0.10
});
test("Every suspension condition refuses new entries and SAST days roll over correctly",()=>{
  for(const [state,reason] of [[{stopped:true},"EMERGENCY_STOP"],[{uncertain:true},"RECONCILIATION_REQUIRED"],[{dailyLossZar:6},"DAILY_LOSS_LIMIT"],
    [{equityZar:180,peakEquityZar:200},"DRAWDOWN_LIMIT"],[{consecutiveLosses:3},"CONSECUTIVE_LOSS_LIMIT"],[{openPositions:1},"POSITION_LIMIT"]])assert.equal(lossGuard(state),reason);
  assert.equal(daySast(Date.parse("2026-11-05T22:00:00Z")),"2026-11-06");
});
test("Customer IDs are deterministic and unique across side, mode and candle",()=>{
  const s=inputs().signal;assert.equal(orderKey(s),orderKey(s));
  assert.notEqual(orderKey(s),orderKey(s,"LIVE"));assert.notEqual(orderKey(s),orderKey({...s,direction:"SHORT"}));
  assert.match(orderKey(s),/^[a-zA-Z0-9-]{1,50}$/);
});
test("Decimal sizing invariants hold across varied prices, ticks, stop distances and FX",()=>{
  let approved=0;
  for(let n=0;n<300;n++){
    const i=inputs(),price=1+n*1.37;i.signal.entry=price;i.signal.stop=price*.98;i.book.bid=String(price*.9999);i.book.ask=String(price*1.0001);
    i.spec.tickSize="0.0001";i.spec.baseDecimalPlaces="4";i.spec.minBaseAmount="0.0001";i.fx.ask=String(14+n%7);i.fx.bid=String(Number(i.fx.ask)-.01);
    const p=buildPlan(i);if(!p.approved)continue;approved++;
    assert.ok(D(p.plannedRiskZar).lte(2));assert.ok(D(p.quantity).mod(.0001).eq(0));assert.ok(D(p.entry).mod(.0001).eq(0));
    assert.ok(D(p.marginUsdt).mul(p.fxAsk).lte(40));
  }
  assert.ok(approved>200);
});
