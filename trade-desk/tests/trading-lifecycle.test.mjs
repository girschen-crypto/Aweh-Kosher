import test from "node:test";
import assert from "node:assert/strict";
import { runTradingCycle,reconcileLive } from "../../netlify/functions/_shared/tradedesk-trading-engine.mjs";
import { buildPlan,POLICY_HASH } from "../../netlify/functions/_shared/tradedesk-trading-policy.mjs";
import { inputs,NOW } from "./trading-fixtures.mjs";
function setup(mode="PAPER",options={}){
  const i=inputs(),rows=[],events=[];
  const config={mode,stopped:false,approval:{phase:"CONTROLLED_TEST",baselineUsdt:"12",policyHash:POLICY_HASH,...options.approval}};
  const journal={
    async control(){return structuredClone(config);},
    async stop(reason){config.stopped=true;config.stopReason=reason;},
    async active(){return rows.find(t=>!['CLOSED','REJECTED','CANCELLED'].includes(t.state))||null;},
    async reserve(plan,mode,beforeUsdt){if(rows.some(t=>t.id===plan.customerOrderId)||await this.active())return null;
      const t={id:plan.customerOrderId,mode,state:"RESERVED",created_at:new Date(NOW).toISOString(),data:{plan,beforeUsdt}};rows.push(t);return structuredClone(t);},
    async update(old,state,patch={}){const t=rows.find(x=>x.id===old.id);assert.equal(t.state,old.state,"CAS update");t.state=state;Object.assign(t.data,patch);return structuredClone(t);},
    async metrics(){return {equityZar:200,peakEquityZar:200,dailyLossZar:0,consecutiveLosses:0,...options.metrics};},
    async event(tradeId,kind,data){events.push({tradeId,kind,data});},async trade(id){return rows.find(t=>t.id===id);},
  };
  const proof={exchangeStatus:"online",fx:i.fx,markets:[{pair:i.signal.pair,spec:i.spec,book:i.book,fundingRate:i.fundingRate,
    tier:{leverageMultiple:2},orderTypes:["LIMIT","MARKET_REDUCE_ONLY"]}]};
  const snapshot={scannedAt:new Date(NOW).toISOString(),results:[i.signal]};
  const account={keyInfo:{isSubAccount:true,permissions:["View access","Trade"]},enablement:{futuresEnabled:true,inLiquidation:false},margin:{},
    balances:[{currency:"USDT",available:"12",total:"12"}],positions:[],openOrders:[],conditionals:[],fees:[{currencyPair:i.signal.pair,takerPercentage:"0.07"}]};
  const client={approval:config.approval,entries:0,closes:0,cancels:0,
    assertWrite(){},async account(){return structuredClone(account);},
    async entry(plan){this.entries++;this.plan=plan;
      if(options.timeout){const e=Error("timeout");e.ambiguous=true;e.code="EXCHANGE_TIMEOUT";throw e;}
      const quantity=options.partial?"0.02":plan.quantity;
      account.positions=[{pair:plan.pair,positionId:"position1",side:plan.direction==="LONG"?"buy":"sell",quantity,averageEntryPrice:plan.entry,unrealisedPnl:"0"}];
      if(!options.missingStop)account.conditionals=[{currencyPair:plan.pair,linkedOrderId:"entry1",orderId:"protection1",customerOrderId:plan.customerOrderId+"P"}];
      return {id:"entry1"};},
    async summary(){if(options.timeout)throw Error("Still unknown");return {orderId:"entry1",orderStatusType:"Filled",totalExecutedQuantity:account.positions[0]?.quantity||"0",remainingQuantity:options.partial&&this.cancels===0?"0.02":"0",averagePrice:this.plan.entry,totalFee:"0.001",feeCurrency:"USDT"};},
    async cancelEntry(){this.cancels++;},async order(){return {remainingQuantity:"0"};},
    async conditional(){const p=this.plan;return {orderId:"protection1",orderStatusType:"Placed",currencyPair:p.pair,conditionalType:"OT_OCO",triggerType:"MARK_PRICE",
      triggerOrderType:"limit-reduce-only",triggerOrderSide:p.direction==="LONG"?"sell":"buy",quantity:"0",stopLossTriggerPrice:p.stop,takeProfitTriggerPrice:p.target,stopLossPlacePrice:"-1",takeProfitPlacePrice:"-1"};},
    async close(){this.closes++;return {id:"close1"};},
    async request(method,path){assert.equal(method,"GET");if(path==="/v1/positions/open")return structuredClone(account.positions);
      if(path.startsWith("/v1/margin/leverage/"))return {leverageMultiple:2,initialMarginFraction:.5};
      if(path.startsWith("/v1/positions/funding/history")||path.startsWith("/v1/account/transactionhistory"))return [];
      if(path.startsWith("/v1/positions/closed"))return [{positionId:"position1",fees:"0.001",quantity:this.plan.quantity,averageEntryPrice:this.plan.entry,closePrice:String(Number(this.plan.entry)-.2)}];throw Error("Unexpected mock route");},
  };
  const run=()=>runTradingCycle({journal,proof,snapshot,client,now:NOW,env:{}});
  return {journal,client,proof,snapshot,account,rows,events,config,run};
}
test("Paper lifecycle produces simulated entries and exits without private exchange writes",async()=>{
  const s=setup();await s.run();assert.equal(s.rows[0].state,"OPEN");assert.equal(s.client.entries,0);
  s.proof.markets[0].book.bid="97";await s.run();assert.equal(s.rows[0].state,"CLOSED");
  assert.ok(Number(s.rows[0].data.netZar)<0);assert.equal(s.rows[0].data.simulated,true);assert.equal(s.client.closes,0);
});
test("Live lifecycle confirms fill and active protection rather than trusting accepted order IDs",async()=>{
  const s=setup("LIVE");await s.run();assert.equal(s.client.entries,1);assert.equal(s.rows[0].state,"OPEN");
  assert.equal(s.rows[0].data.protectionVerified,true);assert.equal(s.rows[0].data.positionId,"position1");
  assert.ok(s.events.some(x=>x.kind==="ENTRY_ACCEPTED_NOT_YET_FILLED"));
});
test("An ambiguous entry timeout is never resubmitted after a restart",async()=>{
  const s=setup("LIVE",{timeout:true});await s.run();assert.equal(s.rows[0].state,"UNCERTAIN");assert.equal(s.config.stopped,true);
  await s.run();assert.equal(s.client.entries,1);assert.equal(s.rows.length,1);
});
test("Missing protection attempts a reduce-only close and suspends further entries",async()=>{
  const s=setup("LIVE",{missingStop:true});await s.run();assert.equal(s.client.closes,1);assert.equal(s.config.stopped,true);
  assert.equal(s.rows[0].state,"CLOSING");await s.run();assert.equal(s.client.entries,1);assert.equal(s.client.closes,1);
});
test("Unexpected partial fills cancel the remainder and protect only the actual position",async()=>{
  const s=setup("LIVE",{partial:true});await s.run();assert.equal(s.client.cancels,1);assert.equal(s.rows[0].data.filledQuantity,"0.02");
  assert.equal(s.rows[0].data.protectionVerified,true);
});
test("Emergency stop preserves existing exchange protection and blocks another entry",async()=>{
  const s=setup("LIVE");await s.run();s.config.stopped=true;
  await s.run();assert.equal(s.client.entries,1);assert.equal(s.client.closes,0);assert.equal(s.account.conditionals.length,1);
});
test("Open unrealised drawdown triggers reduction even when protective orders are present",async()=>{
  const s=setup("LIVE");await s.run();s.account.positions[0].unrealisedPnl="-2";await s.run();
  assert.equal(s.client.closes,1);assert.equal(s.config.stopReason,"DRAWDOWN_LIMIT");
});
test("Daily losses, drawdown and consecutive losses persistently suspend new entries",async()=>{
  for(const metrics of [{dailyLossZar:6},{equityZar:180},{consecutiveLosses:3}]){
    const s=setup("LIVE",{metrics});await s.run();assert.equal(s.client.entries,0);assert.equal(s.config.stopped,true);
  }
});
test("Unexpected account activity, authentication failure and exchange restrictions fail closed",async()=>{
  const s=setup("LIVE");s.account.openOrders=[{orderId:"manual"}];await s.run();assert.equal(s.client.entries,0);assert.equal(s.config.stopped,true);
  const b=setup("LIVE");b.client.account=async()=>{throw Error("401");};await b.run();assert.equal(b.client.entries,0);assert.equal(b.config.stopped,true);
  const c=setup("LIVE");c.proof.exchangeStatus="read-only";await c.run();assert.equal(c.client.entries,0);assert.equal(c.config.stopped,true);
});
test("Restarting between durable reservation and submission cannot create an unrecorded entry",async()=>{
  const s=setup("LIVE");const p=buildPlan(inputs({account:{mode:"LIVE"}}));await s.journal.reserve(p,"LIVE","12");await s.run();
  assert.equal(s.rows[0].state,"UNCERTAIN");assert.equal(s.client.entries,0);assert.equal(s.config.stopped,true);
});
test("A reconciled controlled test closes the journal and requires review before unattended trading",async()=>{
  const s=setup("LIVE");await s.run();s.account.positions=[];s.account.balances[0].total="11.99";
  await s.run();assert.equal(s.rows[0].state,"CLOSED");assert.equal(s.config.stopReason,"CONTROLLED_TEST_COMPLETED_REVIEW_REQUIRED");
  assert.ok(Number(s.rows[0].data.netZar)<0);
});
