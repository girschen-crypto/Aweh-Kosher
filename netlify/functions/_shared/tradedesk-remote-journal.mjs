import { randomUUID,timingSafeEqual } from 'node:crypto';
import { computeMetrics } from './tradedesk-metrics.mjs';
import { POLICY_HASH } from './tradedesk-trading-policy.mjs';
const EXPECTED_URL='https://vyvinzpsfhvxdzxfuwiw.supabase.co/functions/v1/tradedesk-journal';
export function remoteConfigured(env){return env.TRADEDESK_JOURNAL_URL===EXPECTED_URL&&/^[a-f0-9]{64}$/.test(env.TRADEDESK_JOURNAL_TOKEN||'');}
// This trigger can reach only the paper-only adapter, even when a PG URL is also present.
export function verifyPaperTrigger(request,env){
  const value=request.headers.get('x-tradedesk-paper-token')||'';
  return env.CONTEXT==='production'&&remoteConfigured(env)&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(env.TRADEDESK_JOURNAL_TOKEN));
}
export class RemotePaperJournal{
  constructor({env=process.env,fetchFn=fetch}={}){if(!remoteConfigured(env))throw Error('TRANSACTIONAL_DATABASE_NOT_CONFIGURED');this.env=env;this.fetchFn=fetchFn;this.lease=null;}
  async call(op,args={}){
    const r=await this.fetchFn(EXPECTED_URL,{method:'POST',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','x-tradedesk-journal-token':this.env.TRADEDESK_JOURNAL_TOKEN},
      body:JSON.stringify({op,args,lease:this.lease}),signal:AbortSignal.timeout(10000)});
    const data=await r.json();if(!r.ok||data.ok!==true)throw Error(data.error||'JOURNAL_UNAVAILABLE');return data.result;
  }
  async acquire(){this.lease=await this.call('acquire',{owner:randomUUID()});return !!this.lease;}
  async release(){if(this.lease)await this.call('release');this.lease=null;}
  control(){return this.call('control');}
  diagnostic(data){return this.call('diagnostic',{data});}
  stop(reason){return this.call('stop',{reason});}
  active(mode){return this.call('active',{mode});}
  reserve(plan,mode){return this.call('reserve',{plan:{...plan,mode},mode});}
  update(trade,state,patch={}){return this.call('update',{id:trade.id,from:trade.state,state,patch});}
  event(tradeId,kind,data){return this.call('event',{tradeId,kind,data});}
  trades(mode){return this.call('trades',{mode});}
  trade(id){return this.call('trade',{id});}
  async metrics(mode,now=Date.now()){return computeMetrics(await this.call('closed',{mode}),now);}
  events(){return this.call('events');}
  observe(data){return this.call('observe',data);}
  forward(){return this.call('forward',{policyHash:POLICY_HASH});}
}
