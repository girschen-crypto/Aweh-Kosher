import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { MARKETS } from "./tradedesk-radar.mjs";

Decimal.set({precision:36,rounding:Decimal.ROUND_DOWN});
export const D=v=>{try{const d=new Decimal(v);if(!d.isFinite())throw Error();return d;}catch{throw Error("INVALID_DECIMAL");}};
export const LIMITS=Object.freeze({capitalZar:200,riskZar:2,leverage:2,maxPositions:1,dailyLossZar:6,
  drawdownZar:20,consecutiveLosses:3,maxMarginZar:40,minNetRewardRisk:1.2,grossRewardRisk:3,
  maxSpreadBps:15,slippagePerSide:0.0005,maxFundingPerHour:0.0001,maxHoldingHours:2,
  maxSignalAgeMs:20*60000,maxBookAgeMs:30000,maxFeedAgeMs:60000});
export const POLICY_HASH=createHash("sha256").update(JSON.stringify(LIMITS)).digest("hex");
export const daySast=at=>new Date(Number(at)+7200000).toISOString().slice(0,10);
export const roundStep=(value,step,up=false)=>D(value).div(D(step)).toDecimalPlaces(0,up?Decimal.ROUND_CEIL:Decimal.ROUND_FLOOR).mul(D(step));
export const orderKey=(signal,mode="PAPER")=>"TD"+createHash("sha256").update([mode,signal.pair,signal.time,signal.direction,POLICY_HASH].join(":" )).digest("hex").slice(0,40);
export function lossGuard({equityZar=200,peakEquityZar=200,dailyLossZar=0,consecutiveLosses=0,openPositions=0,stopped=false,uncertain=false}={}){
  if(stopped)return "EMERGENCY_STOP";
  if(uncertain)return "RECONCILIATION_REQUIRED";
  if(openPositions>=LIMITS.maxPositions)return "POSITION_LIMIT";
  if(D(peakEquityZar).minus(equityZar).gte(LIMITS.drawdownZar))return "DRAWDOWN_LIMIT";
  if(D(dailyLossZar).gte(LIMITS.dailyLossZar))return "DAILY_LOSS_LIMIT";
  if(consecutiveLosses>=LIMITS.consecutiveLosses)return "CONSECUTIVE_LOSS_LIMIT";
  if(D(equityZar).lte(0))return "NO_CAPITAL";
  return null;
}
export function buildPlan({signal,spec,book,fx,feeRate,fundingRate,account={},now=Date.now(),historical=false}={}){
  const reject=reason=>({approved:false,reason,executable:false,policyHash:POLICY_HASH});
  try{
    const guard=lossGuard(account);if(guard)return reject(guard);
    if(!MARKETS.includes(signal?.pair)||!['LONG','SHORT'].includes(signal?.direction))return reject("NO_SIGNAL");
    if(!spec?.active||spec.currencyPairType!=="FUTURE"||spec.symbol!==signal.pair||spec.quoteCurrency!=="USDT")return reject("UNVERIFIED_CONTRACT");
    const age=now-Date.parse(signal.time);
    if(!Number.isFinite(age)||age<0||age>LIMITS.maxSignalAgeMs)return reject("STALE_SIGNAL");
    if(!historical && [book?.observedAt,fx?.observedAt].some(t=>!Number.isFinite(Date.parse(t))||now-Date.parse(t)<0||now-Date.parse(t)>LIMITS.maxFeedAgeMs))return reject("STALE_MARKET_SNAPSHOT");
    if(!historical && (!Number.isFinite(Date.parse(book?.changedAt))||now-Date.parse(book.changedAt)>LIMITS.maxBookAgeMs||Date.parse(book.changedAt)>now+1000))return reject("STALE_ORDER_BOOK");
    const bid=D(book.bid),ask=D(book.ask),fxAsk=D(fx.ask),fxBid=D(fx.bid),fee=D(feeRate),funding=D(fundingRate).abs();
    if(!bid.gt(0)||!ask.gte(bid)||!fxBid.gt(0)||!fxAsk.gte(fxBid)||fee.lt(0)||fee.gt(.001)||funding.gt(LIMITS.maxFundingPerHour))return reject("INVALID_COST_OR_FX");
    const spread=ask.minus(bid).div(ask.plus(bid).div(2));
    if(spread.mul(10000).gt(LIMITS.maxSpreadBps))return reject("SPREAD_TOO_WIDE");
    const long=signal.direction==="LONG",tick=D(spec.tickSize),quantum=D(10).pow(-Number(spec.baseDecimalPlaces));
    if(!tick.gt(0)||!Number.isInteger(Number(spec.baseDecimalPlaces))||Number(spec.baseDecimalPlaces)<0||Number(spec.baseDecimalPlaces)>12)return reject("INVALID_PRECISION");
    const entry=roundStep((long?ask:bid).mul(long?1+LIMITS.slippagePerSide:1-LIMITS.slippagePerSide),tick,long);
    const distance=D(signal.entry).minus(signal.stop).abs();
    if(!distance.gt(0)||long&&D(signal.stop).gte(signal.entry)||!long&&D(signal.stop).lte(signal.entry))return reject("INVALID_STOP");
    const stop=roundStep(long?entry.minus(distance):entry.plus(distance),tick,!long);
    const target=roundStep(long?entry.plus(distance.mul(LIMITS.grossRewardRisk)):entry.minus(distance.mul(LIMITS.grossRewardRisk)),tick,!long);
    if(!stop.gt(0)||!target.gt(0)||long&&!(stop.lt(entry)&&target.gt(entry))||!long&&!(stop.gt(entry)&&target.lt(entry)))return reject("INVALID_PROTECTION");
    const buffer=entry.mul(D(LIMITS.slippagePerSide).mul(2).plus(spread).plus(D(LIMITS.maxFundingPerHour).mul(LIMITS.maxHoldingHours)));
    const lossUnit=entry.minus(stop).abs().plus(entry.plus(stop).mul(fee)).plus(buffer);
    const gainUnit=entry.minus(target).abs().minus(entry.plus(target).mul(fee)).minus(buffer);
    if(!gainUnit.gt(0)||gainUnit.div(lossUnit).lt(LIMITS.minNetRewardRisk))return reject("INSUFFICIENT_NET_REWARD");
    const budget=Decimal.min(LIMITS.riskZar,D(LIMITS.dailyLossZar).minus(account.dailyLossZar||0),D(LIMITS.drawdownZar).minus(D(account.peakEquityZar||200).minus(account.equityZar||200)));
    const equity=Decimal.min(account.equityZar??200,LIMITS.capitalZar),available=D(account.availableUsdt??equity.div(fxAsk));
    const qty=roundStep(Decimal.min(budget.div(lossUnit.mul(fxAsk)),
      D(LIMITS.maxMarginZar).mul(LIMITS.leverage).div(entry.mul(fxAsk)),
      equity.mul(LIMITS.leverage).div(entry.mul(fxAsk)),available.div(entry.div(LIMITS.leverage).plus(entry.mul(fee)))),quantum);
    const notional=qty.mul(entry),margin=notional.div(LIMITS.leverage),risk=qty.mul(lossUnit).mul(fxAsk);
    if(qty.lt(spec.minBaseAmount)||notional.lt(spec.minQuoteAmount)||qty.gt(spec.maxBaseAmount)||notional.gt(spec.maxQuoteAmount))return reject("BELOW_EXCHANGE_MINIMUM_OR_ABOVE_MAXIMUM");
    if(!qty.gt(0)||risk.gt(LIMITS.riskZar)||margin.mul(fxAsk).gt(LIMITS.maxMarginZar))return reject("RISK_LIMIT");
    const depth=D(long?book.askDepth:book.bidDepth);
    if(depth.lt(qty.mul(3)))return reject("INSUFFICIENT_LIQUIDITY");
    return {approved:true,executable:false,reason:"Risk, cost, precision and liquidity checks passed",pair:signal.pair,
      direction:signal.direction,signalTime:signal.time,customerOrderId:orderKey(signal,account.mode||"PAPER"),
      quantity:qty.toFixed(Number(spec.baseDecimalPlaces)),entry:entry.toFixed(),stop:stop.toFixed(),target:target.toFixed(),
      notionalUsdt:notional.toFixed(),marginUsdt:margin.toFixed(),plannedRiskZar:risk.toFixed(8),
      netRewardRisk:gainUnit.div(lossUnit).toFixed(4),feeRate:fee.toFixed(),fxAsk:fxAsk.toFixed(),fxBid:fxBid.toFixed(),
      costReserveUsdt:buffer.mul(qty).toFixed(),createdAt:new Date(now).toISOString(),policyHash:POLICY_HASH};
  }catch{return reject("INVALID_OR_MISSING_INPUT");}
}
export function capitalMinimum(spec,ask,fx){
  const unit=D(10).pow(-Number(spec.baseDecimalPlaces));
  const qty=roundStep(Decimal.max(spec.minBaseAmount,D(spec.minQuoteAmount).div(ask)),unit,true);
  const notional=qty.mul(ask),margin=notional.div(2).mul(fx);
  return {pair:spec.symbol,quantity:qty.toFixed(),notionalUsdt:notional.toFixed(),marginZar:margin.toFixed(2),
    fitsMarginCap:margin.lte(LIMITS.maxMarginZar),riskStillRequired:true};
}
