import { signValr } from "../tradedesk-valr-balances.mjs";
import { MARKETS } from "./tradedesk-radar.mjs";
import { D, POLICY_HASH } from "./tradedesk-trading-policy.mjs";
import { researchGate,researchReport } from "./tradedesk-release.mjs";
const BASE="https://api.valr.com";
const READ=[/^\/v1\/account\/(balances|api-keys\/current|fees\/trade)$/, /^\/v1\/margin\/account\/status$/, /^\/v2\/margin\/status$/,
  /^\/v1\/account\/transactionhistory\?.*$/,
  /^\/v1\/margin\/leverage\/(BTC|ETH|SOL|XRP)USDTPERP$/, /^\/v1\/positions\/(open|closed|closed\/summary|funding\/history)(\?.*)?$/,
  /^\/v1\/orders\/open$/, /^\/v1\/orders\/conditionals$/, /^\/v1\/orders\/conditionals\/conditional\/(BTC|ETH|SOL|XRP)USDTPERP\/orderid\/[a-zA-Z0-9-]+$/,
  /^\/v1\/orders\/(BTC|ETH|SOL|XRP)USDTPERP\/(orderid|customerorderid)\/[a-zA-Z0-9-]+$/,
  /^\/v1\/orders\/history\/summary\/(orderid|customerorderid)\/[a-zA-Z0-9-]+$/];
export class ValrError extends Error{constructor(code,{status=0,ambiguous=false}={}){super(code);this.code=code;this.status=status;this.ambiguous=ambiguous;}}
export class ValrExecutionClient{
  constructor({env=process.env,fetchFn=fetch,now=Date.now,purpose="read",approval=null,evidence=researchReport}={}){Object.assign(this,{env,fetchFn,now,purpose,approval,evidence});}
  credentials(){const prefix=this.purpose==="trade"?"TRADEDESK_VALR_TRADE_":"TRADEDESK_VALR_";
    const key=this.env[prefix+"API_KEY"],secret=this.env[prefix+"API_SECRET"];
    if(!/^[A-Za-z0-9]{64}$/.test(key||"")||!/^[A-Za-z0-9]{64}$/.test(secret||""))throw new ValrError("PRIVATE_CREDENTIALS_MISSING");return {key,secret};}
  assertWrite(kind){
    const a=this.approval,e=this.env;
    if(this.purpose!=="trade"||e.CONTEXT!=="production"||!a||!["CONTROLLED_TEST","UNATTENDED"].includes(a.phase)||e.TRADEDESK_LIVE_AUTHORIZED!==a.phase||
      a.policyHash!==POLICY_HASH||!a.approvedAt||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=this.now())throw new ValrError("LIVE_EXECUTION_LOCKED");
    if(kind==="entry" && (a.deployCommit!==e.COMMIT_REF||!a.strategyEvidenceApproved||!a.accountVerified||a.capitalZar!==200||
      a.phase==="UNATTENDED"&&!a.controlledTestTradeId))throw new ValrError("ACTIVATION_REVALIDATION_REQUIRED");
    if(kind==="entry"){const reason=researchGate(this.evidence);if(reason)throw new ValrError(reason);}
  }
  async request(method,path,body,kind="read"){
    if(method==="GET"){if(!READ.some(x=>x.test(path)))throw new ValrError("ROUTE_FORBIDDEN");}
    else{
      this.assertWrite(kind);
      if(!["/v2/orders/limit","/v2/orders/market","/v2/orders/order","/v1/orders/conditionals"].includes(path))throw new ValrError("ROUTE_FORBIDDEN");
      if(!MARKETS.includes(body?.pair))throw new ValrError("PAIR_FORBIDDEN");
      if(path==="/v2/orders/market"&&body.reduceOnly!==true)throw new ValrError("REDUCE_ONLY_REQUIRED");
      if(kind==="entry"&&(path!=="/v2/orders/limit"||method!=="POST"||body.timeInForce!=="FOK"||!body.conditionalOrderData))throw new ValrError("ATTACHED_PROTECTION_REQUIRED");
      if(kind!=="entry"&&path==="/v2/orders/limit")throw new ValrError("ROUTE_FORBIDDEN");
    }
    const {key,secret}=this.credentials(),timestamp=String(this.now()),payload=body?JSON.stringify(body):"";
    let response;
    try{response=await this.fetchFn(BASE+path,{method,body:payload||undefined,headers:{"Content-Type":"application/json",Accept:"application/json",
      "X-VALR-API-KEY":key,"X-VALR-TIMESTAMP":timestamp,"X-VALR-SIGNATURE":signValr(secret,timestamp,method,path,payload)},
      redirect:"error",cache:"no-store",signal:AbortSignal.timeout(6000)});}catch{throw new ValrError("EXCHANGE_TIMEOUT",{ambiguous:method!=="GET"});}
    if(!response.ok)throw new ValrError(response.status===401||response.status===403?"EXCHANGE_AUTH_FAILED":response.status===429?"EXCHANGE_RATE_LIMIT":"EXCHANGE_REJECTED",
      {status:response.status,ambiguous:method!=="GET"&&response.status>=500});
    try{const text=await response.text();return text?JSON.parse(text):null;}
    catch{throw new ValrError("INVALID_EXCHANGE_RESPONSE",{ambiguous:method!=="GET"});}
  }
  async account(){
    const [keyInfo,balances,enablement,positions,openOrders,conditionals,fees,margin]=await Promise.all([
      this.request("GET","/v1/account/api-keys/current"),this.request("GET","/v1/account/balances"),
      this.request("GET","/v1/margin/account/status"),this.request("GET","/v1/positions/open"),this.request("GET","/v1/orders/open"),
      this.request("GET","/v1/orders/conditionals"),this.request("GET","/v1/account/fees/trade"),this.request("GET","/v2/margin/status").catch(()=>null),
    ]);
    if(![balances,positions,openOrders,conditionals,fees].every(Array.isArray)||positions.length>=100)throw new ValrError("ACCOUNT_RESPONSE_INCOMPLETE");
    return {keyInfo,balances,enablement,positions,openOrders,conditionals,fees,margin,observedAt:new Date(this.now()).toISOString()};
  }
  async order(pair,customerId){
    try{return await this.request("GET","/v1/orders/"+pair+"/customerorderid/"+customerId);}
    catch(e){if(e.status!==404)throw e;return this.request("GET","/v1/orders/history/summary/customerorderid/"+customerId);}
  }
  async summary(customerId){return this.request("GET","/v1/orders/history/summary/customerorderid/"+customerId);}
  entry(plan){return this.request("POST","/v2/orders/limit",{side:plan.direction==="LONG"?"BUY":"SELL",pair:plan.pair,quantity:plan.quantity,
    price:plan.entry,timeInForce:"FOK",postOnly:false,customerOrderId:plan.customerOrderId,
    conditionalOrderData:{quantity:"0",triggerType:"MARK_PRICE",takeProfitTriggerPrice:plan.target,takeProfitOrderPrice:"-1",
      stopLossTriggerPrice:plan.stop,stopLossOrderPrice:"-1",customerOrderId:plan.customerOrderId+"P"}},"entry");}
  cancelEntry(plan){return this.request("DELETE","/v2/orders/order",{pair:plan.pair,customerOrderId:plan.customerOrderId},"cancel");}
  close(position,id){return this.request("POST","/v2/orders/market",{pair:position.pair,side:position.side.toLowerCase()==="buy"?"SELL":"BUY",
    baseAmount:D(position.quantity).toFixed(),reduceOnly:true,customerOrderId:id},"reduce");}
  conditional(pair,id){return this.request("GET","/v1/orders/conditionals/conditional/"+pair+"/orderid/"+id);}
}
export function verifyProtection(conditional,position,plan){
  try{return conditional?.orderStatusType==="Placed"&&conditional.currencyPair===plan.pair&&
    ["OCO","OT_OCO"].includes(conditional.conditionalType)&&conditional.triggerType==="MARK_PRICE"&&
    ["limit-reduce-only","market-reduce-only"].includes(conditional.triggerOrderType)&&
    conditional.triggerOrderSide?.toLowerCase()===(position.side.toLowerCase()==="buy"?"sell":"buy")&&
    (D(conditional.quantity).eq(0)||D(conditional.quantity).eq(position.quantity))&&
    D(conditional.stopLossTriggerPrice).eq(plan.stop)&&D(conditional.takeProfitTriggerPrice).eq(plan.target)&&
    D(conditional.stopLossPlacePrice).eq(-1)&&D(conditional.takeProfitPlacePrice).eq(-1);
  }catch{return false;}
}
export function verifyPrivateAccount(a,{requireTrade=false}={}){
  const permissions=new Set((a?.keyInfo?.permissions||[]).map(x=>String(x).toLowerCase()));
  if(a?.keyInfo?.isSubAccount!==true)return "SUBACCOUNT_KEY_REQUIRED";
  if(!permissions.has("view access")||requireTrade&&!permissions.has("trade"))return "KEY_PERMISSIONS_MISSING";
  if([...permissions].some(x=>!["view access",...(requireTrade?["trade"]:[])].includes(x)))return "EXCESSIVE_KEY_PERMISSIONS";
  if(a.enablement?.futuresEnabled!==true||a.enablement?.inLiquidation!==false)return "FUTURES_ACCOUNT_NOT_READY";
  if(requireTrade&&!a.margin)return "MARGIN_HEALTH_UNVERIFIED";
  if(a.balances.some(x=>x.currency!=="USDT"&&!D(x.total).eq(0)))return "USDT_ONLY_COLLATERAL_REQUIRED";
  if(a.balances.some(x=>D(x.total).lt(0)||D(x.borrowedAmount||0).gt(0)))return "BORROWING_NOT_ALLOWED";
  return null;
}
