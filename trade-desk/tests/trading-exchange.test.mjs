import test from "node:test";
import assert from "node:assert/strict";
import { signValr } from "../../netlify/functions/tradedesk-valr-balances.mjs";
import { POLICY_HASH,buildPlan } from "../../netlify/functions/_shared/tradedesk-trading-policy.mjs";
import { ValrExecutionClient,verifyProtection,verifyPrivateAccount } from "../../netlify/functions/_shared/tradedesk-valr-execution.mjs";
import { handleTrading } from "../../netlify/functions/tradedesk-trading.mjs";
import { inputs,NOW } from "./trading-fixtures.mjs";
const env={CONTEXT:"production",COMMIT_REF:"commit",TRADEDESK_LIVE_AUTHORIZED:"CONTROLLED_TEST",TRADEDESK_VALR_TRADE_API_KEY:"a".repeat(64),TRADEDESK_VALR_TRADE_API_SECRET:"b".repeat(64)};
const approval={policyHash:POLICY_HASH,phase:"CONTROLLED_TEST",approvedAt:new Date(NOW).toISOString(),expiresAt:NOW+3600000,deployCommit:"commit",strategyEvidenceApproved:true,accountVerified:true,capitalZar:200};
const plan=buildPlan(inputs());
const evidence={policyHash:POLICY_HASH,readyForControlledTest:true,forwardTestDays:8,forwardClosedTrades:25,results:{holdout:{trades:25,netZar:"5",profitFactor:"1.2",maxDrawdownZar:"4"}}};
test("No combination of a read-only key, preview or missing approval can submit an order",async()=>{
  let calls=0;const fetchFn=async()=>{calls++;throw Error("Must not reach exchange");};
  for(const config of [{env,purpose:"read",approval},{env:{...env,CONTEXT:"deploy-preview"},purpose:"trade",approval},
    {env:{...env,TRADEDESK_LIVE_AUTHORIZED:""},purpose:"trade",approval},{env,purpose:"trade",approval:null},
    {env,purpose:"trade",approval:{...approval,expiresAt:NOW-1}},{env,purpose:"trade",approval:{...approval,deployCommit:"old"}}]){
    const c=new ValrExecutionClient({...config,fetchFn,now:()=>NOW});await assert.rejects(c.entry(plan));
  }
  assert.equal(calls,0);
});
test("Documented FOK entry includes attached reduce-only OCO protection and a correct server signature",async()=>{
  let called=0;
  const c=new ValrExecutionClient({env,purpose:"trade",approval,evidence,now:()=>NOW,fetchFn:async(url,options)=>{
    called++;assert.equal(url,"https://api.valr.com/v2/orders/limit");assert.equal(options.method,"POST");
    assert.equal(options.headers["X-VALR-SIGNATURE"],signValr("b".repeat(64),String(NOW),"POST","/v2/orders/limit",options.body));
    const body=JSON.parse(options.body);assert.equal(body.timeInForce,"FOK");assert.equal(body.conditionalOrderData.quantity,"0");
    assert.equal(body.conditionalOrderData.stopLossOrderPrice,"-1");assert.equal(body.conditionalOrderData.triggerType,"MARK_PRICE");
    return new Response(JSON.stringify({id:"accepted-only"}),{status:202});
  }});
  assert.deepEqual(await c.entry(plan),{id:"accepted-only"});assert.equal(called,1);
});
test("Timeouts on mutating requests are ambiguous and are not retried",async()=>{
  let calls=0;const c=new ValrExecutionClient({env,purpose:"trade",approval,evidence,now:()=>NOW,fetchFn:async()=>{calls++;throw Error("timeout");}});
  await assert.rejects(c.entry(plan),e=>e.ambiguous===true);assert.equal(calls,1);
});
test("A broken response body after order acceptance is also ambiguous",async()=>{
  const c=new ValrExecutionClient({env,purpose:"trade",approval,evidence,now:()=>NOW,
    fetchFn:async()=>({ok:true,status:202,text:async()=>{throw Error("connection lost while reading");}})});
  await assert.rejects(c.entry(plan),e=>e.ambiguous===true);
});
test("Transfers, withdrawals, arbitrary URLs and non-reducing market orders are never allowed",async()=>{
  const c=new ValrExecutionClient({env,purpose:"trade",approval,evidence,now:()=>NOW,fetchFn:()=>{throw Error("NO_NETWORK");}});
  for(const path of ["/v1/account/subaccounts/transfer","/v1/wallet/crypto/USDT/withdraw","https://elsewhere.example"])
    await assert.rejects(c.request("POST",path,{pair:"SOLUSDTPERP"},"entry"),/ROUTE_FORBIDDEN/);
  await assert.rejects(c.request("POST","/v2/orders/market",{pair:"SOLUSDTPERP",reduceOnly:false},"reduce"),/REDUCE_ONLY/);
});
test("A production key and approval cannot bypass the actual failed strategy evidence",async()=>{
  let calls=0;const c=new ValrExecutionClient({env,purpose:"trade",approval,now:()=>NOW,fetchFn:async()=>{calls++;}});
  await assert.rejects(c.entry(plan),/STRATEGY_NOT_APPROVED/);assert.equal(calls,0);
});
test("Protective order verification checks side, quantity, pair, trigger, prices and active status",()=>{
  const position={side:"buy",quantity:plan.quantity};
  const p={orderStatusType:"Placed",currencyPair:plan.pair,conditionalType:"OT_OCO",triggerType:"MARK_PRICE",triggerOrderType:"limit-reduce-only",triggerOrderSide:"sell",
    quantity:"0",stopLossTriggerPrice:plan.stop,takeProfitTriggerPrice:plan.target,stopLossPlacePrice:"-1",takeProfitPlacePrice:"-1"};
  assert.equal(verifyProtection(p,position,plan),true);
  for(const patch of [{orderStatusType:"Triggered"},{triggerOrderSide:"buy"},{quantity:"1"},{currencyPair:"BTCUSDTPERP"},{stopLossPlacePrice:"98"},{stopLossTriggerPrice:"0"}])
    assert.equal(verifyProtection({...p,...patch},position,plan),false);
});
test("Only a dedicated futures subaccount with restricted permissions and USDT collateral qualifies",()=>{
  const a={keyInfo:{isSubAccount:true,permissions:["View access","Trade"]},enablement:{futuresEnabled:true,inLiquidation:false},margin:{},balances:[{currency:"USDT",total:"12"}]};
  assert.equal(verifyPrivateAccount(a,{requireTrade:true}),null);
  assert.equal(verifyPrivateAccount({...a,keyInfo:{...a.keyInfo,permissions:["View access","Trade","Withdraw"]}},{requireTrade:true}),"EXCESSIVE_KEY_PERMISSIONS");
  assert.equal(verifyPrivateAccount({...a,keyInfo:{...a.keyInfo,isSubAccount:false}},{requireTrade:true}),"SUBACCOUNT_KEY_REQUIRED");
});
test("Public status reveals no private balances and cannot activate or stop trading",async()=>{
  const req=action=>new Request("https://mrg-trade-desk.netlify.app/.netlify/functions/tradedesk-trading",{method:"POST",body:JSON.stringify({action})});
  const s=await (await handleTrading(req("status"),{env:{}})).json();assert.equal(s.liveEnabled,false);assert.equal(s.mode,"PAPER");assert.equal(s.balances,undefined);
  assert.equal((await handleTrading(req("activate"),{env:{}})).status,401);assert.equal((await handleTrading(req("stop"),{env:{}})).status,401);
});
