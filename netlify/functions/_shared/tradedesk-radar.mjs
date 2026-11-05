/**
 * TradeDesk signal detector. Public VALR futures data only; no VALR credentials.
 * A signal is NOT a guaranteed profitable trade. All results are observations.
 * NEVER place orders or change user funds from this module.
 */
export const MARKETS=Object.freeze(["BTCUSDTPERP","ETHUSDTPERP","SOLUSDTPERP","XRPUSDTPERP"]);
export const RULES=Object.freeze({
  candleSeconds:900, minCandles:60, fastEMA:9, slowEMA:21,
  rsiPeriod:14, atrPeriod:14, riskZar:2, budgetZar:200,
  maxMarginZar:40, maxLeverage:2, takerFeePerSide:0.0007,
});
const API="https://api.valr.com/v1/public/";
const num=value=>{const x=Number(value);return Number.isFinite(x)?x:NaN;};
const round=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const BAD="Market feed unavailable or unverified. No signal.";
function timeValue(v){
  if(v===undefined||v===null)return NaN;
  if(typeof v==="number")return v<1e11?v*1000:v;
  if(typeof v==="string" && /^\d{10,13}$/.test(v))return timeValue(Number(v));
  return Date.parse(String(v));
}
export function normaliseCandles(raw,now=Date.now()){
  const source=Array.isArray(raw)?raw:Array.isArray(raw?.buckets)?raw.buckets:
    Array.isArray(raw?.data)?raw.data:Array.isArray(raw?.items)?raw.items:[];
  const seen=new Map();
  for(const b of source){
    const time=timeValue(b?.startTime??b?.start??b?.bucketStart??b?.bucketStartTime??b?.timestamp??b?.time);
    const open=num(b?.open??b?.openPrice??b?.o);
    const high=num(b?.high??b?.highPrice??b?.h);
    const low=num(b?.low??b?.lowPrice??b?.l);
    const close=num(b?.close??b?.closePrice??b?.c);
    if(!Number.isFinite(time)||time<=0||time%(RULES.candleSeconds*1000)!==0||time>now||time+RULES.candleSeconds*1000>now-10000)continue;
    if(!(open>0&&close>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)&&low>0))continue;
    const previous=seen.get(time);
    if(previous && ["open","high","low","close"].some(k=>previous[k]!==({open,high,low,close})[k]))return [];
    seen.set(time,{time,open,high,low,close});
  }
  return [...seen.values()].sort((a,b)=>a.time-b.time).slice(-120);
}
export function emaSeries(closes,period){
  if(closes.length<period)return [];
  let current=closes.slice(0,period).reduce((s,x)=>s+x,0)/period;
  const arr=new Array(closes.length).fill(null);
  arr[period-1]=current;
  const weight=2/(period+1);
  for(let i=period;i<closes.length;i++){current=closes[i]*weight+current*(1-weight);arr[i]=current;}
  return arr;
}
export function rsi(closes,n=14){
  if(closes.length<=n)return NaN;
  let gain=0,loss=0;
  for(let i=1;i<=n;i++){const d=closes[i]-closes[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}
  gain/=n;loss/=n;
  for(let i=n+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    gain=(gain*(n-1)+Math.max(0,d))/n;
    loss=(loss*(n-1)+Math.max(0,-d))/n;
  }
  if(loss===0)return gain>0?100:50;
  return 100-100/(1+gain/loss);
}
export function atr(candles,n=14){
  if(candles.length<n+1)return NaN;
  const tr=[];
  for(let i=1;i<candles.length;i++){
    const b=candles[i],prev=candles[i-1].close;
    tr.push(Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev)));
  }
  let average=tr.slice(0,n).reduce((s,x)=>s+x,0)/n;
  for(let i=n;i<tr.length;i++)average=(average*(n-1)+tr[i])/n;
  return average;
}
export function evaluateMarket(pair,candles,now=Date.now()){
  const base={pair,direction:"WAIT",reason:"No qualifying crossover",time:null,indicators:null,
    entry:null,stop:null,target:null,marginR:null,notionalR:null,source:"VALR futures mark price, 15-minute closed candles",executable:false};
  if(!MARKETS.includes(pair))return {...base,reason:"Contract not in authorised watchlist"};
  if(!Array.isArray(candles)||candles.length<RULES.minCandles)
    return {...base,reason:"Insufficient verified candle history"};
  // Every candle used by EMA/RSI/ATR must be valid and consecutive, not only the last two.
  const step=RULES.candleSeconds*1000;
  if(candles.some((b,i)=>!b||!Number.isFinite(b.time)||b.time%step!==0||
    ![b.open,b.high,b.low,b.close].every(Number.isFinite)||
    !(b.open>0&&b.close>0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close))||
    (i>0&&b.time-candles[i-1].time!==step)))
    return {...base,reason:"Malformed or discontinuous market data"};
  const c=candles.at(-1);
  const age=now-(c.time+RULES.candleSeconds*1000);
  if(age<0||age>20*60*1000)
    return {...base,reason:"Stale or discontinuous market data"};
  const closes=candles.map(x=>x.close),fast=emaSeries(closes,9),slow=emaSeries(closes,21),trend=emaSeries(closes,50);
  const i=closes.length-1,rr=rsi(closes),a=atr(candles),vol=a/c.close;
  if(![fast[i],fast[i-1],slow[i],slow[i-1],rr,a,vol].every(Number.isFinite))
    return {...base,reason:"Indicators incomplete"};
  const indicators={ema9:round(fast[i]),ema21:round(slow[i]),ema50:round(trend[i]),rsi14:round(rr,2),atr14:round(a),atrPct:round(100*vol,2)};
  const context={...base,time:new Date(c.time+900000).toISOString(),indicators,entry:round(c.close)};
  if(vol<0.001||vol>0.05)return {...context,reason:"Volatility outside safety filter"};
  const longCross=fast[i-1]<=slow[i-1]&&fast[i]>slow[i]&&rr>=52&&rr<=70&&c.close>slow[i];
  const shortCross=fast[i-1]>=slow[i-1]&&fast[i]<slow[i]&&rr<=48&&rr>=30&&c.close<slow[i];
  if(!longCross&&!shortCross)return {...context,reason:"No confirmed EMA(9/21) crossover plus RSI filter"};
  const direction=longCross?"LONG":"SHORT",distance=a*1.5;
  if(longCross&&!(c.close>trend[i]&&slow[i]>slow[i-1])||shortCross&&!(c.close<trend[i]&&slow[i]<slow[i-1]))
    return {...context,reason:"Crossover rejected by EMA50 trend and EMA21 slope"};
  const stop=longCross?c.close-distance:c.close+distance;
  const target=longCross?c.close+distance*3:c.close-distance*3;
  if(!(stop>0&&target>0))return {...context,reason:"Invalid proposed risk levels"};
  const costRate=(RULES.takerFeePerSide*2)+0.001; // model 0.1% slippage allowance
  const stopMove=distance/c.close;
  const maxNotional=Math.min(RULES.maxMarginZar*RULES.maxLeverage,
    RULES.riskZar/(stopMove+costRate));
  // ZAR sizing is an illustrative upper bound only; no currency conversion
  // or venue-specific minimum order quantity has been verified.
  return {...context,direction,reason:"Fresh EMA crossover confirmed by RSI and ATR",
    stop:round(stop),target:round(target),
    marginR:round(maxNotional/RULES.maxLeverage,2),notionalR:round(maxNotional,2),
    stopPct:round(100*stopMove,2),feeAllowanceR:round(maxNotional*costRate,2),
    executable:false};
}
function eligiblePairs(info){
  const values=Array.isArray(info)?info:Array.isArray(info?.futuresInfo)?info.futuresInfo:
    Array.isArray(info?.pairs)?info.pairs:Array.isArray(info?.data)?info.data:[];
  const set=new Set();
  for(const x of values){
    const symbol=typeof x==="string"?x:x?.currencyPair??x?.pairSymbol??x?.symbol;
    if(typeof symbol==="string"&&MARKETS.includes(symbol.toUpperCase()))set.add(symbol.toUpperCase());
  }
  return set;
}
async function getJSON(url,fetchFn){
  const response=await fetchFn(url,{method:"GET",headers:{"Accept":"application/json"},
    redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error("VALR_API_"+response.status);
  const body=await response.json();
  if(!body||typeof body!=="object")throw Error("INVALID_MARKET_RESPONSE");
  return body;
}
export async function scanMarkets({fetchFn=fetch,now=Date.now()}={}){
  const latest={scannedAt:new Date(now).toISOString(),mode:"SIGNALS_ONLY_PAPER",
    source:"VALR public market data",budgetZar:RULES.budgetZar,riskLimitZar:RULES.riskZar,
    scanIntervalMinutes:15,results:[],newSignalCount:0};
  let eligible;
  try{eligible=eligiblePairs(await getJSON(API+"futures/info",fetchFn));}
  catch{latest.error="VALR futures market list unavailable; no signals issued";return latest;}
  latest.results=await Promise.all(MARKETS.map(async pair=>{
    if(!eligible.has(pair))return {pair,direction:"WAIT",reason:"Not verified as currently listed VALR futures contract",executable:false};
    try{
      // Futures mark-price candles: NEVER silently substitute spot prices.
      const raw=await getJSON(API+pair+"/markprice/buckets?periodSeconds=900",fetchFn);
      return evaluateMarket(pair,normaliseCandles(raw,now),now);
    }catch{return {pair,direction:"WAIT",reason:BAD,executable:false};}
  }));
  latest.newSignalCount=latest.results.filter(r=>r.direction==="LONG"||r.direction==="SHORT").length;
  return latest;
}
