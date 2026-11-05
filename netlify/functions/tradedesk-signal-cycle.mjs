/**
 * VALR public market-data scanner. It NEVER reads brokerage secrets or orders.
 * Runs each 15 minutes on existing Netlify site. Netlify Blobs keeps most
 * recent scan and deduplicated historical signals. No new hosting needed.
 */
import { getStore } from "@netlify/blobs";
import { scanMarkets } from "./_shared/tradedesk-radar.mjs";

const STORE="tradedesk-signal-history-v1";
export function storeForSignals(){return getStore({name:STORE,consistency:"strong"});}

export async function runSignalCycle({store=storeForSignals(),fetchFn=fetch,now=Date.now()}={}){
  const snapshot=await scanMarkets({fetchFn,now});
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
  // Logs omit any secret, balance or VALR account reference.
  return {scannedAt:snapshot.scannedAt,markets:snapshot.results.length,
    newEvents,error:snapshot.error||null};
}

export default async function () {
  try {
    const result=await runSignalCycle();
    console.info("TradeDesk public signal scan",result);
  } catch {
    console.warn("TradeDesk signal scan unavailable; no orders were sent");
  }
  return new Response(null,{status:204});
}

export const config={schedule:"*/15 * * * *"};
