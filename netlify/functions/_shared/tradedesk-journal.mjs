import pg from "pg";
import Decimal from "decimal.js";
import { daySast,D } from "./tradedesk-trading-policy.mjs";
let pool;
export function databasePool(env=process.env){
  if(!env.TRADEDESK_DATABASE_URL)throw Error("TRANSACTIONAL_DATABASE_NOT_CONFIGURED");
  if(!pool)pool=new pg.Pool({connectionString:env.TRADEDESK_DATABASE_URL,max:2,connectionTimeoutMillis:5000,
    idleTimeoutMillis:1000,ssl:{rejectUnauthorized:true}});
  return pool;
}
export class TradingJournal{
  constructor(client){this.client=client;}
  async control(){const r=await this.client.query("SELECT data FROM td_control WHERE id=1");if(!r.rows[0])throw Error("DATABASE_SCHEMA_MISSING");return r.rows[0].data;}
  async stop(reason){await this.client.query("UPDATE td_control SET data=jsonb_set(jsonb_set(data,'{stopped}','true'),'{stopReason}',to_jsonb($1::text)) WHERE id=1",[reason]);await this.event(null,"SUSPENDED",{reason});}
  async active(mode){const r=await this.client.query("SELECT * FROM td_trades WHERE mode=$1 AND state NOT IN ('CLOSED','CANCELLED','REJECTED') ORDER BY created_at",[mode]);if(r.rows.length>1)throw Error("MULTIPLE_ACTIVE_INTENTS");return r.rows[0]||null;}
  async reserve(plan,mode,beforeUsdt=null){
    const data={plan,beforeUsdt,positionId:null,protectionVerified:false};
    const r=await this.client.query("INSERT INTO td_trades(id,mode,signal_key,state,data) VALUES($1,$2,$3,'RESERVED',$4::jsonb) ON CONFLICT DO NOTHING RETURNING *",
      [plan.customerOrderId,mode,[plan.pair,plan.signalTime,plan.direction].join(":"),JSON.stringify(data)]);
    return r.rows[0]||null;
  }
  async update(trade,state,patch={}){
    const r=await this.client.query("UPDATE td_trades SET state=$2,data=data||$3::jsonb,updated_at=now(),closed_at=CASE WHEN $2 IN ('CLOSED','CANCELLED','REJECTED') THEN now() ELSE closed_at END WHERE id=$1 AND state=$4 RETURNING *",
      [trade.id,state,JSON.stringify(patch),trade.state]);
    if(r.rows.length!==1)throw Error("JOURNAL_CONFLICT");return r.rows[0];
  }
  async event(tradeId,kind,data){await this.client.query("INSERT INTO td_events(trade_id,kind,data) VALUES($1,$2,$3::jsonb)",[tradeId,kind,JSON.stringify(data)]);}
  async trades(mode){return (await this.client.query("SELECT * FROM td_trades WHERE mode=$1 ORDER BY created_at DESC LIMIT 1000",[mode])).rows;}
  async trade(id){return (await this.client.query("SELECT * FROM td_trades WHERE id=$1",[id])).rows[0]||null;}
  async metrics(mode,now=Date.now()){
    const all=(await this.client.query("SELECT data,closed_at FROM td_trades WHERE mode=$1 AND state='CLOSED' ORDER BY closed_at,id",[mode])).rows;
    let equity=D(200),peak=D(200),maxDrawdown=D(0),dailyLoss=D(0),consecutiveLosses=0,wins=0,losses=0,fees=D(0),netUsdt=D(0);
    const today=daySast(now);
    for(const t of all){const net=D(t.data.netZar);equity=equity.plus(net);peak=Decimal.max(peak,equity);maxDrawdown=Decimal.max(maxDrawdown,peak.minus(equity));
      if(net.lt(0)){losses++;consecutiveLosses++;if(daySast(new Date(t.closed_at).getTime())===today)dailyLoss=dailyLoss.minus(net);}else{if(net.gt(0))wins++;consecutiveLosses=0;}
      fees=fees.plus(t.data.feesZar||0);
      netUsdt=netUsdt.plus(t.data.netUsdt||0);
    }
    return {equityZar:equity.toFixed(),peakEquityZar:peak.toFixed(),maxDrawdownZar:maxDrawdown.toFixed(),dailyLossZar:dailyLoss.toFixed(),consecutiveLosses,
      totalNetZar:equity.minus(200).toFixed(),totalNetUsdt:netUsdt.toFixed(),trades:all.length,wins,losses,feesZar:fees.toFixed(),winRate:all.length?wins/all.length:null};
  }
}
export async function withTradingLock(fn,{pool:provided,env=process.env}={}){
  const client=await (provided||databasePool(env)).connect();let locked=false;
  try{
    const r=await client.query("SELECT pg_try_advisory_lock(7472616465) AS locked");locked=r.rows[0]?.locked===true;
    if(!locked)return {skipped:true,reason:"CYCLE_ALREADY_RUNNING"};
    return await fn(new TradingJournal(client));
  }finally{if(locked)await client.query("SELECT pg_advisory_unlock(7472616465)").catch(()=>{});client.release();}
}
