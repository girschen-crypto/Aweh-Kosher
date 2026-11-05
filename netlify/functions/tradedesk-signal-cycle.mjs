/**
 * VALR public market-data scanner. It NEVER reads brokerage secrets or orders.
 * Runs each 15 minutes on existing Netlify site. Netlify Blobs keeps most
 * recent scan and deduplicated historical signals. No new hosting needed.
 */
import { getStore } from "@netlify/blobs";
import { scanMarkets } from "./_shared/tradedesk-radar.mjs";
import { collectMarketProof } from "./_shared/tradedesk-valr-market.mjs";

const STORE="tradedesk-signal-history-v1";
export function storeForSignals(){return getStore({name:STORE,consistency:"strong"});}

export async function runSignalCycle({store=storeForSignals(),fetchFn=fetch,now=Date.now(),collectProof=false}={}){
  const snapshot=await scanMarkets({fetchFn,now});
  if(collectProof){try{snapshot.marketProof=await collectMarketProof({fetchFn,now:Date.now()});}catch{snapshot.marketProof={error:"CAPITAL_AND_LIQUIDITY_CHECK_UNAVAILABLE"};}}
  const current=await store.get("snapshot", {type:"json",consistency:"strong"}).catch(()=>null);
  const history=await store.get("history", {type:"json",consistency:"strong"}).catch(()=>[]);
  const list=Array.isArray(history)?history:[];
  const existing=new Set(list.map(e=>e.id));
  let newEvents=0;
  for(const item of snapshot.results||[]){
    if(!["LONG","SHORT"].includes(item.direction)||!item.time||!item.entry)continue;
    const id=[item.pair,item.time,item.direction].join(":");
    if(existing.has(id))continue;
    list.unshift({id,pair:item.pair,at:item.time,direction:item.direction,
      source:item.source,entry:item.entry,stop:item.stop,target:item.target,
      reason:item.reason,executable:false});
    existing.add(id);newEvents++;
  }
  snapshot.newEvents=newEvents;
  snapshot.history=list.slice(0,40);
  // No record should ever contain owner balances, keys, or order instructions.
  await store.setJSON("snapshot",snapshot);
  await store.setJSON("history",list.slice(0,100));
  // Immutable public observations support forward research without treating Blobs as an order database.
  await store.setJSON("forward/"+snapshot.scannedAt,snapshot,{onlyIfNew:true});
  // Logs omit any secret, balance or VALR account reference.
  return {scannedAt:snapshot.scannedAt,markets:snapshot.results.length,
    newEvents,error:snapshot.error||null};
}

export default async function () {
  try {
    const result=await runSignalCycle();
    console.info("TradeDesk public signal scan",result);
    // Only configured transactional storage starts the separate paper/execution worker.
    // Live writes remain independently locked by approval, account, policy and deployment gates.
    if(process.env.CONTEXT==="production"&&process.env.TRADEDESK_DATABASE_URL&&process.env.TRADEDESK_OWNER_TOKEN){
      await fetch("https://mrg-trade-desk.netlify.app/.netlify/functions/tradedesk-trading-cycle-background",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+process.env.TRADEDESK_OWNER_TOKEN},
        body:"{}",redirect:"error",signal:AbortSignal.timeout(3000)});
    }
  } catch {
    console.warn("TradeDesk signal scan unavailable; no orders were sent");
  }
  return new Response(null,{status:204});
}

export const config={schedule:"*/15 * * * *"};
