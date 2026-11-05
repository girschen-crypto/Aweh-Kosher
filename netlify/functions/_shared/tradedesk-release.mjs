import report from "../../../trade-desk/app/trading-validation.json" with {type:"json"};
import { D,POLICY_HASH,LIMITS } from "./tradedesk-trading-policy.mjs";
export const researchReport=report;
export function researchGate(evidence=report){
  try{
    if(evidence.policyHash!==POLICY_HASH)return "EVIDENCE_POLICY_MISMATCH";
    if(evidence.readyForControlledTest!==true)return "STRATEGY_NOT_APPROVED";
    if(evidence.forwardTestDays<7||evidence.forwardClosedTrades<20)return "FORWARD_EVIDENCE_INSUFFICIENT";
    const h=evidence.results?.holdout;
    if(!h||h.trades<20||!D(h.netZar).gt(0)||!D(h.profitFactor).gte(1.1)||D(h.maxDrawdownZar).gt(LIMITS.drawdownZar))return "HOLDOUT_EVIDENCE_INSUFFICIENT";
    return null;
  }catch{return "INVALID_STRATEGY_EVIDENCE";}
}
