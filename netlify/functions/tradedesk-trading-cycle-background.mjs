import { allowedOrigin,verifyOwnerToken } from "./_shared/tradedesk-passkey-session.mjs";
import { storeForSignals } from "./tradedesk-signal-cycle.mjs";
import { collectMarketProof } from "./_shared/tradedesk-valr-market.mjs";
import { persistentTradingCycle } from "./_shared/tradedesk-trading-engine.mjs";
import { journalConfigured } from "./_shared/tradedesk-journal.mjs";
import { tradingRuntime } from "./_shared/tradedesk-runtime.mjs";
export default async function(request,context){
  const env=tradingRuntime(context);
  // Previews and unauthorised calls never touch order state or private APIs.
  if(env.CONTEXT!=="production"||!allowedOrigin(request)||!verifyOwnerToken(request,env)||!journalConfigured(env))return;
  try{
    const snapshot=await storeForSignals().get("snapshot",{type:"json",consistency:"strong"});
    const proof=await collectMarketProof();
    await persistentTradingCycle({snapshot,proof,env});
  }catch{console.warn("TradeDesk trading cycle incomplete; reconciliation required before any new entry");}
}
export const config={background:true};
