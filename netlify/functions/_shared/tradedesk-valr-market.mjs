import { MARKETS } from "./tradedesk-radar.mjs";
import { capitalMinimum } from "./tradedesk-trading-policy.mjs";
const BASE="https://api.valr.com/v1/public/";
export async function publicJSON(path,fetchFn=fetch,timeoutMs=7000){
  const r=await fetchFn(BASE+path,{method:"GET",redirect:"error",cache:"no-store",headers:{Accept:"application/json"},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok){const e=Error("PUBLIC_API_"+r.status);e.status=r.status;e.retryAfter=Number(r.headers?.get?.("retry-after")||30);throw e;}return r.json();
}
export function bookView(raw,observedAt){
  const asks=(raw?.Asks||[]).filter(x=>Number(x.price)>0&&Number(x.quantity)>0).sort((a,b)=>Number(a.price)-Number(b.price));
  const bids=(raw?.Bids||[]).filter(x=>Number(x.price)>0&&Number(x.quantity)>0).sort((a,b)=>Number(b.price)-Number(a.price));
  if(!asks.length||!bids.length)throw Error("EMPTY_ORDER_BOOK");
  const ask=Number(asks[0].price),bid=Number(bids[0].price);
  return {ask:asks[0].price,bid:bids[0].price,changedAt:raw.LastChange,observedAt,
    askDepth:String(asks.filter(x=>Number(x.price)<=ask*1.0005).reduce((s,x)=>s+Number(x.quantity),0)),
    bidDepth:String(bids.filter(x=>Number(x.price)>=bid*.9995).reduce((s,x)=>s+Number(x.quantity),0))};
}
export async function collectMarketProof({fetchFn=fetch,now=Date.now()}={}){
  const at=new Date(now).toISOString();
  const [pairs,futures,status,fxRaw,...raw]=await Promise.all([
    publicJSON("pairs",fetchFn),publicJSON("futures/info",fetchFn),publicJSON("status",fetchFn),publicJSON("USDTZAR/orderbook",fetchFn),
    ...MARKETS.map(async pair=>{try{const [book,types,tiers]=await Promise.all([publicJSON(pair+"/orderbook",fetchFn),publicJSON(pair+"/ordertypes",fetchFn),publicJSON("risklimit/"+pair,fetchFn)]);return {pair,book,types,tiers};}catch{return {pair,error:"MARKET_VERIFICATION_UNAVAILABLE"};}}),
  ]);
  const fx=bookView(fxRaw,at),listed=new Set(futures.map(x=>x.currencyPair));
  const markets=raw.map(x=>{
    const spec=pairs.find(p=>p.symbol===x.pair),funding=futures.find(p=>p.currencyPair===x.pair);
    if(x.error||!listed.has(x.pair)||!spec?.active||spec.currencyPairType!=="FUTURE")return {pair:x.pair,error:x.error||"NOT_LISTED"};
    const book=bookView(x.book,at),tier=x.tiers.find(t=>Number(t.leverageMultiple)===2);
    return {pair:x.pair,spec,book,orderTypes:x.types,tier: tier||null,fundingRate:funding.estimatedFundingRate,
      minimum:capitalMinimum(spec,book.ask,fx.ask)};
  });
  return {observedAt:at,exchangeStatus:typeof status==="string"?status:status.status,fx,markets,
    feeAssumption:{rate:"0.0007",source:"VALR published tier-1 futures taker rate; account-specific rate must be verified",accountVerified:false}};
}
