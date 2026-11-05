import { allowedOrigin,verifyOwnerToken,validSession } from "./_shared/tradedesk-passkey-session.mjs";
import { LIMITS,POLICY_HASH } from "./_shared/tradedesk-trading-policy.mjs";
import { ValrExecutionClient,verifyPrivateAccount } from "./_shared/tradedesk-valr-execution.mjs";
import { withJournal,journalConfigured } from "./_shared/tradedesk-journal.mjs";
import { researchGate } from "./_shared/tradedesk-release.mjs";
import { tradingRuntime } from "./_shared/tradedesk-runtime.mjs";
const H={"Content-Type":"application/json","Cache-Control":"private, no-store","Vary":"Cookie, Authorization","X-Content-Type-Options":"nosniff"};
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:H});
export async function handleTrading(request,{env=process.env,pool,client}={}){
  if(request.method!=="POST")return reply(405,{ok:false,error:"METHOD_NOT_ALLOWED"});
  if(!allowedOrigin(request))return reply(403,{ok:false,error:"ORIGIN_REJECTED"});
  let data;try{data=await request.json();}catch{return reply(400,{ok:false,error:"INVALID_JSON"});}
  if(data.action==="status"){
    let mode="PAPER",liveEnabled=false,journalHealthy=false,forward=null;
    if(journalConfigured(env)){try{await withJournal(async journal=>{
      const config=await journal.control();mode=config.mode==="LIVE"?"LIVE":"PAPER";journalHealthy=true;
      if(journal.forward)forward=await journal.forward();
      if(mode==="LIVE"&&!config.stopped){const executor=new ValrExecutionClient({env,purpose:"trade",approval:config.approval});executor.assertWrite("entry");executor.credentials();liveEnabled=true;}
    },{env,pool});}catch{liveEnabled=false;journalHealthy=false;}}
    return reply(200,{ok:true,mode,liveEnabled,activationRequired:!liveEnabled,researchBlocker:researchGate(),policy:LIMITS,policyHash:POLICY_HASH,
    databaseConfigured:journalConfigured(env),journalHealthy,forward,separateTradeKeyConfigured:!!env.TRADEDESK_VALR_TRADE_API_KEY&&!!env.TRADEDESK_VALR_TRADE_API_SECRET,
    message:liveEnabled?"Live mode authorised. Refer to authenticated journal for positions, protection and risk status.":"Real orders are locked pending strategy evidence, private account verification and explicit activation approval."});
  }
  if(!verifyOwnerToken(request,env)&&!validSession(request,env))return reply(401,{ok:false,error:"SIGN_IN_REQUIRED"});
  if(data.action==="activate")return reply(409,{ok:false,error:"EXPLICIT_ACTIVATION_REVIEW_REQUIRED"});
  if(!["account","journal","stop"].includes(data.action))return reply(400,{ok:false,error:"INVALID_ACTION"});
  try{
    if(data.action==="account"){
      client ||= new ValrExecutionClient({env});const a=await client.account();
      const project=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]??null]));
      return reply(200,{ok:true,mode:"READ_ONLY",observedAt:a.observedAt,readinessError:verifyPrivateAccount(a),
        futuresEnabled:a.enablement.futuresEnabled,inLiquidation:a.enablement.inLiquidation,
        balances:a.balances.filter(b=>b.currency==="USDT"||b.currency==="ZAR").map(b=>project(b,["currency","available","total","reserved"])),
        positions:a.positions.map(p=>project(p,["pair","side","quantity","averageEntryPrice","unrealisedPnl","realisedPnl","positionId","leverageTier"])),
        protectiveOrders:a.conditionals.map(p=>project(p,["orderId","currencyPair","quantity","triggerType","conditionalType","stopLossTriggerPrice","takeProfitTriggerPrice","triggerOrderSide"])),
        protectionConfirmed:false,protectionNote:"Listing conditionals alone does not verify protection; the execution engine must reconcile each position and conditional status."});
    }
    return await withJournal(async journal=>{
      if(data.action==="stop"){await journal.stop("OWNER_EMERGENCY_STOP");return reply(200,{ok:true,stopped:true,message:"New entries stopped. Existing exchange protective orders were preserved."});}
      const config=await journal.control(),mode=config.mode==="LIVE"?"LIVE":"PAPER";
      return reply(200,{ok:true,mode,stopped:config.stopped,stopReason:config.stopReason||null,
        metrics:await journal.metrics(mode),active:await journal.active(mode),trades:(await journal.trades(mode)).slice(0,50),
        accountReadiness:config.accountReadiness||null,events:journal.events?await journal.events():[],forward:journal.forward?await journal.forward():null});
    },{env,pool});
  }catch(e){return reply(503,{ok:false,error:e.message==="TRANSACTIONAL_DATABASE_NOT_CONFIGURED"?"TRANSACTIONAL_DATABASE_NOT_CONFIGURED":
    ["PRIVATE_CREDENTIALS_MISSING","EXCHANGE_AUTH_FAILED","EXCHANGE_RATE_LIMIT"].includes(e.code)?e.code:"TRADING_STATUS_UNAVAILABLE"});}
}
export default (request,context)=>handleTrading(request,{env:tradingRuntime(context)});
