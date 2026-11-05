import { allowedOrigin,verifyOwnerToken } from "./_shared/tradedesk-passkey-session.mjs";
import { storeForSignals } from "./tradedesk-signal-cycle.mjs";
import { collectMarketProof } from "./_shared/tradedesk-valr-market.mjs";
import { persistentTradingCycle } from "./_shared/tradedesk-trading-engine.mjs";
export default async function(request){
  // Previews and unauthorised calls never touch order state or private APIs.
  if(process.env.CONTEXT!=="production"||!allowedOrigin(request)||!verifyOwnerToken(request)||!process.env.TRADEDESK_DATABASE_URL)return;
  try{
    const snapshot=await storeForSignals().get("snapshot",{type:"json",consistency:"strong"});
    const proof=await collectMarketProof();
    await persistentTradingCycle({snapshot,proof,env:process.env});
  }catch{console.warn("TradeDesk trading cycle incomplete; reconciliation required before any new entry");}
}
export const config={background:true};
