import { D,LIMITS,POLICY_HASH,buildPlan,lossGuard } from "./tradedesk-trading-policy.mjs";
import { ValrExecutionClient,verifyProtection,verifyPrivateAccount } from "./tradedesk-valr-execution.mjs";
import { withTradingLock } from "./tradedesk-journal.mjs";
const zeroUsdt=a=>a.balances.find(x=>x.currency==="USDT")||{total:"0",available:"0"};
const positionFor=(a,pair)=>a.positions.find(x=>x.pair===pair&&D(x.quantity).gt(0));
function ownedConditional(a,t){return a.conditionals.filter(x=>x.currencyPair===t.data.plan.pair&&
  (x.linkedOrderId===t.data.entryOrderId||x.customerOrderId===t.id+"P"));}
export async function reconcileLive(t,{journal,client,account,proof,now=Date.now(),forceCloseReason=null}={}){
  const plan=t.data.plan,position=positionFor(account,plan.pair);
  if(t.state==="RESERVED"){
    // A restart/deploy between reservation and submission must never guess or retry an entry.
    await journal.stop("RESTART_BEFORE_ENTRY_CONFIRMATION");return journal.update(t,"UNCERTAIN",{reason:"Manual reconciliation required"});
  }
  if(["SUBMITTING","UNCERTAIN"].includes(t.state)){
    let order;try{order=await client.summary(t.id);}catch{await journal.stop("ENTRY_STATUS_UNKNOWN");return t;}
    if(!order?.orderId){await journal.stop("ENTRY_STATUS_UNKNOWN");return t;}
    const qty=D(order.totalExecutedQuantity||0);
    if(qty.eq(0)&&D(order.remainingQuantity||0).gt(0)){
      await client.cancelEntry(plan);const cancelled=await client.summary(t.id);
      if(D(cancelled.totalExecutedQuantity||0).eq(0)&&["Cancelled","Rejected","Failed"].includes(cancelled.orderStatusType))return journal.update(t,"CANCELLED",{reason:"UNFILLED_ENTRY_CANCELLED"});
      await journal.stop("CANCELLATION_REQUIRES_RECONCILIATION");return journal.update(t,"UNCERTAIN");
    }
    if(qty.eq(0)&&["Cancelled","Failed","Rejected"].includes(order.orderStatusType))return journal.update(t,"REJECTED",{orderStatus:order.orderStatusType});
    if(!position){await journal.stop("ORDER_POSITION_MISMATCH");return journal.update(t,"UNCERTAIN");}
    if(qty.gt(plan.quantity)||!D(position.quantity).eq(qty)||position.side.toLowerCase()!==(plan.direction==="LONG"?"buy":"sell")){
      await journal.stop("UNEXPECTED_POSITION");return journal.update(t,"UNCERTAIN");
    }
    if(D(order.remainingQuantity||0).gt(0)){await client.cancelEntry(plan);const after=await client.order(plan.pair,t.id);
      if(D(after.remainingQuantity||0).gt(0)){await journal.stop("ENTRY_CANCEL_UNCONFIRMED");return journal.update(t,"UNCERTAIN");}}
    t=await journal.update(t,"PROTECTING",{entryOrderId:order.orderId,filledQuantity:qty.toFixed(),entryPrice:order.averagePrice,
      positionId:position.positionId,entryFeesUsdt:order.totalFee??null,entryFeeCurrency:order.feeCurrency??null});
  }
  if(!position){
    if(!t.data.positionId||!t.data.beforeUsdt){await journal.stop("CLOSED_POSITION_NOT_RECONCILED");return t;}
    // A USDT-only account with no other activity permits exact net-cost accounting by wallet delta.
    const closed=await client.request("GET","/v1/positions/closed?limit=100");
    const records=closed.filter(x=>x.positionId===t.data.positionId);
    if(!records.length||closed.length>=100){await journal.stop("EXIT_HISTORY_INCOMPLETE");return t;}
    const [funding,ledger]=await Promise.all([
      client.request("GET","/v1/positions/funding/history?currencyPair="+plan.pair+"&startTime="+encodeURIComponent(new Date(t.created_at).toISOString())+"&limit=100"),
      client.request("GET","/v1/account/transactionhistory?startTime="+encodeURIComponent(new Date(t.created_at).toISOString())+"&endTime="+encodeURIComponent(new Date(now).toISOString())+"&limit=100"),
    ]);
    const foreignTypes=/DEPOSIT|WITHDRAW|TRANSFER|PAYMENT|REFERRAL|REBATE|REWARD|BORROW|LEND|SWAP|RECEIVE|SEND/;
    if(!Array.isArray(funding)||!Array.isArray(ledger)||funding.length>=100||ledger.length>=100||ledger.some(x=>foreignTypes.test(x.transactionType?.type||""))){
      await journal.stop("EXTERNAL_CASH_FLOW_OR_INCOMPLETE_LEDGER");return t;
    }
    const relevantFunding=funding.filter(x=>x.positionId===t.data.positionId);
    const fees=D(t.data.entryFeesUsdt).plus(records.reduce((s,x)=>s.plus(x.fees),D(0)));
    const fundingNet=relevantFunding.reduce((s,x)=>s.plus(x.fundingAmount),D(0));
    const gross=records.reduce((s,x)=>s.plus((plan.direction==="LONG"?D(x.closePrice).minus(x.averageEntryPrice):D(x.averageEntryPrice).minus(x.closePrice)).mul(x.quantity)),D(0));
    const closedQty=records.reduce((s,x)=>s.plus(x.quantity),D(0));
    const net=D(zeroUsdt(account).total).minus(t.data.beforeUsdt),fx=net.gte(0)?proof.fx.bid:proof.fx.ask;
    if(t.data.entryFeeCurrency!=="USDT"||!closedQty.eq(t.data.filledQuantity)||!gross.minus(fees).plus(fundingNet).minus(net).abs().lte(.000001)){
      await journal.stop("NET_PNL_ACCOUNTING_NOT_RECONCILED");return t;
    }
    const netZar=net.mul(fx);
    t=await journal.update(t,"CLOSED",{netUsdt:net.toFixed(),netZar:netZar.toFixed(),fxAtExit:fx,
      accounting:"USDT wallet delta; includes fees and funding; requires dedicated account without external activity",exitRecords:records,
      protectionVerified:t.data.protectionVerified,feesZar:fees.mul(fx).toFixed(),fundingZar:fundingNet.mul(fx).toFixed()});
    await journal.event(t.id,"EXIT_RECONCILED",{netZar:netZar.toFixed()});
    // A controlled test always suspends after its first complete lifecycle.
    if(client.approval?.phase!=="UNATTENDED")await journal.stop("CONTROLLED_TEST_COMPLETED_REVIEW_REQUIRED");return t;
  }
  if(position.positionId!==t.data.positionId||D(position.quantity).gt(t.data.filledQuantity)||
    position.side.toLowerCase()!==(plan.direction==="LONG"?"buy":"sell")){
    await journal.stop("POSITION_RECONCILIATION_FAILED");return journal.update(t,"UNCERTAIN");
  }
  const candidates=ownedConditional(account,t);
  let protection=null;
  if(candidates.length===1)try{protection=await client.conditional(plan.pair,candidates[0].orderId);}catch{}
  const protectedNow=verifyProtection(protection,position,plan);
  if(!protectedNow||forceCloseReason||now-Date.parse(t.created_at)>LIMITS.maxHoldingHours*3600000){
    await journal.stop(!protectedNow?"PROTECTION_MISSING":forceCloseReason||"MAX_HOLDING_TIME");
    if(t.state==="CLOSING"||t.data.closeRequested){return t;}
    t=await journal.update(t,"CLOSING",{closeRequested:true,protectionVerified:protectedNow});
    // Commit the close intent before transmission. Never duplicate an ambiguous close.
    try{const response=await client.close(position,t.id+"C");await journal.event(t.id,"REDUCE_ONLY_CLOSE_SUBMITTED",{orderId:response?.id||null});}
    catch{await journal.event(t.id,"CLOSE_STATUS_UNCERTAIN",{});}
    const positions=await client.request("GET","/v1/positions/open");
    if(positionFor({positions},plan.pair))await journal.event(t.id,"MANUAL_ATTENTION_REQUIRED",{reason:"Closure not confirmed; preserve existing protective orders"});
    return t;
  }
  t=await journal.update(t,"OPEN",{protectionVerified:true,conditionalOrderId:protection.orderId,
    currentQuantity:position.quantity,unrealisedPnlUsdt:position.unrealisedPnl,lastReconciledAt:new Date(now).toISOString()});
  return t;
}
export const PAPER_EXECUTION_VERSION="BOOK_SNAPSHOTS_V2";
function paperHoldingDeadline(t){
  const openedAt=new Date(t.created_at).getTime(),signalAt=Date.parse(t.data.plan.signalTime);
  if(!Number.isFinite(openedAt))throw Error("INVALID_PAPER_OPEN_TIME");
  // The validated signal comes from a closed 15-minute candle. Anchor the
  // deadline to that decision, so seconds of DB/network delay do not add a bar.
  const anchor=Number.isFinite(signalAt)&&signalAt<=openedAt?signalAt:Math.floor(openedAt/900000)*900000;
  return anchor+LIMITS.maxHoldingHours*3600000;
}
export async function paperTick(t,{journal,proof,now}={}){
  const p=t.data.plan,m=proof.markets.find(x=>x.pair===p.pair);if(!m?.book)return t;
  const price=D(p.direction==="LONG"?m.book.bid:m.book.ask),long=p.direction==="LONG";
  const deadline=paperHoldingDeadline(t);
  const stop=long?price.lte(p.stop):price.gte(p.stop),target=long?price.gte(p.target):price.lte(p.target),expired=now>=deadline;
  if(!stop&&!target&&!expired)return t;
  const exit=price.mul(long?1-LIMITS.slippagePerSide:1+LIMITS.slippagePerSide),qty=D(p.quantity);
  const fees=qty.mul(D(p.entry).plus(exit)).mul(p.feeRate),hours=D(now-Date.parse(t.created_at)).div(3600000).ceil();
  const funding=qty.mul(p.entry).mul(LIMITS.maxFundingPerHour).mul(hours);
  const net=(long?exit.minus(p.entry):D(p.entry).minus(exit)).mul(qty).minus(fees).minus(funding),fx=net.gte(0)?proof.fx.bid:proof.fx.ask;
  return journal.update(t,"CLOSED",{exit:exit.toFixed(),exitReason:stop?"STOP":target?"TARGET":"TIME_LIMIT",
    netUsdt:net.toFixed(),netZar:net.mul(fx).toFixed(),fxAtExit:fx,feesZar:fees.mul(fx).toFixed(),fundingZar:funding.mul(fx).toFixed(),
    holdingDeadlineAt:new Date(deadline).toISOString(),simulationVersion:PAPER_EXECUTION_VERSION,
    simulated:true,protectionVerified:false,simulation:"Public order-book snapshots; simulated exits, not exchange-side orders"});
}
export async function runTradingCycle({journal,snapshot,proof,env=process.env,client,now=Date.now()}={}){
  const config=await journal.control(),mode=config.mode==="LIVE"?"LIVE":"PAPER";
  if(proof.exchangeStatus!=="online") {await journal.stop("EXCHANGE_NOT_ONLINE");return {mode,reason:"EXCHANGE_NOT_ONLINE"};}
  let active=await journal.active(mode),account=null;
  if(mode==="LIVE"){
    client ||= new ValrExecutionClient({env,purpose:"trade",approval:config.approval});
    try{account=await client.account();}catch{await journal.stop("PRIVATE_ACCOUNT_UNAVAILABLE");return {mode,reason:"PRIVATE_ACCOUNT_UNAVAILABLE"};}
    const accountError=verifyPrivateAccount(account,{requireTrade:true});
    if(accountError){await journal.stop(accountError);return {mode,reason:accountError};}
    if(active){
      const metrics=await journal.metrics(mode,now),p=positionFor(account,active.data.plan.pair);
      const markedEquity=D(zeroUsdt(account).total).plus(p?.unrealisedPnl||0).mul(proof.fx.bid);
      const drawdown=D(metrics.peakEquityZar).minus(markedEquity);
      const openRealisedLoss=D(p?.realisedPnl||0).lt(0)?D(p.realisedPnl).negated().mul(proof.fx.ask):D(0);
      const reason=drawdown.gte(LIMITS.drawdownZar)?"DRAWDOWN_LIMIT":D(metrics.dailyLossZar).plus(openRealisedLoss).gte(LIMITS.dailyLossZar)?"DAILY_LOSS_LIMIT":null;
      await reconcileLive(active,{journal,client,account,proof,now,forceCloseReason:reason});return {mode,reconciled:true};
    }
    if(account.positions.length||account.openOrders.length||account.conditionals.length){await journal.stop("UNMANAGED_ACCOUNT_ACTIVITY");return {mode,reason:"UNMANAGED_ACCOUNT_ACTIVITY"};}
    try{client.assertWrite("entry");}catch(e){await journal.stop(e.code||"LIVE_ACTIVATION_BLOCKED");return {mode,reason:e.code||"LIVE_ACTIVATION_BLOCKED"};}
  }else if(active){await paperTick(active,{journal,proof,now});return {mode,reconciled:true};}
  const metrics=await journal.metrics(mode,now),guard=lossGuard({...metrics,stopped:config.stopped});
  if(guard){if(guard!=="EMERGENCY_STOP")await journal.stop(guard);await journal.event(null,"NO_TRADE",{reason:guard,mode});return {mode,reason:guard};}
  const liveEquity=account?D(zeroUsdt(account).total).mul(proof.fx.bid).toFixed():metrics.equityZar;
  if(account&&(!config.approval?.baselineUsdt||!D(zeroUsdt(account).total).eq(D(config.approval.baselineUsdt).plus(metrics.totalNetUsdt||0)))){
    await journal.stop("CAPITAL_OR_LEDGER_RECONCILIATION_REQUIRED");return {mode,reason:"CAPITAL_OR_LEDGER_RECONCILIATION_REQUIRED"};
  }
  if(account&&config.approval?.phase==="UNATTENDED"){
    const test=await journal.trade(config.approval.controlledTestTradeId);
    if(!test||test.mode!=="LIVE"||test.state!=="CLOSED"||test.data.protectionVerified!==true||test.data.plan.policyHash!==POLICY_HASH){
      await journal.stop("CONTROLLED_TEST_NOT_VERIFIED");return {mode,reason:"CONTROLLED_TEST_NOT_VERIFIED"};
    }
  }
  if(!snapshot||now-Date.parse(snapshot.scannedAt)>LIMITS.maxSignalAgeMs||snapshot.error)return {mode,reason:"STALE_SIGNAL_FEED"};
  for(const signal of snapshot.results||[]){
    const market=proof.markets.find(x=>x.pair===signal.pair);if(!market?.spec)continue;
    if(!market.orderTypes?.includes("LIMIT")||!market.orderTypes.includes("MARKET_REDUCE_ONLY")||!market.tier){
      await journal.event(null,"SIGNAL_REJECTED",{pair:signal.pair,reason:"ORDER_CAPABILITIES_NOT_VERIFIED",mode});continue;
    }
    const fee=account?.fees.find(x=>x.currencyPair===signal.pair);
    if(account&&!fee?.takerPercentage){await journal.stop("ACCOUNT_FEE_UNKNOWN");return {mode,reason:"ACCOUNT_FEE_UNKNOWN"};}
    const plan=buildPlan({signal,...market,fx:proof.fx,feeRate:fee?D(fee.takerPercentage).div(100).toFixed():"0.0007",fundingRate:market.fundingRate,
      account:{...metrics,mode,equityZar:liveEquity,availableUsdt:account?zeroUsdt(account).available:undefined},now});
    if(!plan.approved){await journal.event(null,"SIGNAL_REJECTED",{pair:signal.pair,time:signal.time,reason:plan.reason,mode});continue;}
    if(mode==="LIVE"){
      const tier=await client.request("GET","/v1/margin/leverage/"+plan.pair);
      if(Number(tier.leverageMultiple)>2||Number(tier.initialMarginFraction)<.5){await journal.stop("EXCHANGE_LEVERAGE_EXCEEDS_LIMIT");return {mode,reason:"EXCHANGE_LEVERAGE_EXCEEDS_LIMIT"};}
    }
    const t=await journal.reserve(plan,mode,account?zeroUsdt(account).total:null);if(!t)continue;
    await journal.event(t.id,"RISK_APPROVED",{mode,plan,policyHash:POLICY_HASH});
    if(mode==="PAPER"){await journal.update(t,"OPEN",{simulated:true,protectionVerified:false,simulationVersion:PAPER_EXECUTION_VERSION,holdingDeadlineAt:new Date(paperHoldingDeadline(t)).toISOString()});return {mode,openedPaper:true};}
    // Check the persisted emergency stop again immediately before the write.
    if((await journal.control()).stopped){await journal.update(t,"CANCELLED",{reason:"EMERGENCY_STOP"});return {mode,reason:"EMERGENCY_STOP"};}
    const submitting=await journal.update(t,"SUBMITTING");
    try{const response=await client.entry(plan);await journal.event(t.id,"ENTRY_ACCEPTED_NOT_YET_FILLED",{orderId:response?.id||null});}
    catch(error){await journal.stop(error.ambiguous?"ENTRY_OUTCOME_UNKNOWN":"ENTRY_REJECTED");await journal.update(submitting,error.ambiguous?"UNCERTAIN":"REJECTED",{reason:error.code||"EXECUTION_FAILED"});return {mode,reason:error.code||"EXECUTION_FAILED"};}
    const fresh=await client.account();await reconcileLive(submitting,{journal,client,account:fresh,proof,now});
    return {mode,submitted:true};
  }
  return {mode,reason:"NO_ELIGIBLE_SIGNAL"};
}
export async function persistentTradingCycle(input){return withTradingLock(async journal=>{
  if(journal.diagnostic&&input.env.TRADEDESK_VALR_API_KEY&&input.env.TRADEDESK_VALR_API_SECRET){
    const previous=(await journal.control()).accountReadiness;
    if(!previous||Date.now()-Date.parse(previous.observedAt)>86400000){
      let data;
      try{const a=await new ValrExecutionClient({env:input.env,purpose:"read"}).account();
        data={observedAt:a.observedAt,readinessError:verifyPrivateAccount(a),isSubAccount:a.keyInfo.isSubAccount,
          futuresEnabled:a.enablement.futuresEnabled,feesVerified:a.fees.some(x=>x.currencyPair?.endsWith("USDTPERP")&&Number.isFinite(Number(x.takerPercentage)))};
      }catch(e){data={observedAt:new Date().toISOString(),readinessError:["EXCHANGE_AUTH_FAILED","EXCHANGE_RATE_LIMIT","PRIVATE_CREDENTIALS_MISSING","ACCOUNT_RESPONSE_INCOMPLETE","EXCHANGE_TIMEOUT","EXCHANGE_REJECTED"].includes(e.code)?e.code:"PRIVATE_ACCOUNT_UNAVAILABLE"};}
      // Only a readiness projection is persisted. Balances, keys and account identifiers stay private.
      await journal.diagnostic(data);
    }
  }
  const result=await runTradingCycle({...input,journal});
  if(journal.observe&&input.snapshot&&!input.snapshot.error){
    await journal.observe({scannedAt:input.snapshot.scannedAt,policyHash:POLICY_HASH,deployId:input.env.TRADEDESK_DEPLOY_ID,
      data:{signals:input.snapshot.results,proof:input.proof,result,simulationVersion:PAPER_EXECUTION_VERSION,simulation:"Forward paper trial; public prices and modelled costs; no exchange orders"}});
  }
  return result;
},{env:input.env});}
