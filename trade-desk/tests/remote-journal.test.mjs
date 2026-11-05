import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { journalJsonTypes } from '../../supabase/functions/tradedesk-journal/driver-options.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { journalHandler,digest } from '../../supabase/functions/tradedesk-journal/core.mjs';
import { RemotePaperJournal,verifyPaperTrigger } from '../../netlify/functions/_shared/tradedesk-remote-journal.mjs';
import { buildPlan,POLICY_HASH } from '../../netlify/functions/_shared/tradedesk-trading-policy.mjs';
import { inputs } from './trading-fixtures.mjs';
const token='a'.repeat(64),env={TRADEDESK_JOURNAL_URL:'https://vyvinzpsfhvxdzxfuwiw.supabase.co/functions/v1/tradedesk-journal',TRADEDESK_JOURNAL_TOKEN:token};
async function setup(){
  const pg=new PGlite();await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await pg.exec(await readFile(new URL('../../supabase/migrations/20261105112340_tradedesk_private_journal.sql',import.meta.url),'utf8'));
  await pg.query('INSERT INTO tradedesk.runtime_secrets(name,sha256) VALUES($1,$2)',['netlify-paper-journal',await digest(token)]);
  const adapt=connection=>({query:async(q,p)=>(await connection.query(q,p)).rows,transaction:fn=>connection.transaction(tx=>fn(adapt(tx)))});
  const handler=journalHandler(adapt(pg));
  const fetchFn=(url,options)=>handler(new Request(url,options));
  return {pg,handler,fetchFn,journal:new RemotePaperJournal({env,fetchFn})};
}
test('Private paper journal rejects browser access, wrong tokens, SQL operations and live reservations',async()=>{
  const s=await setup();try{
    const request=(body,headers={})=>new Request(env.TRADEDESK_JOURNAL_URL,{method:'POST',headers:{'x-tradedesk-journal-token':token,...headers},body:JSON.stringify(body)});
    assert.equal((await s.handler(request({op:'control'},{Origin:'https://mrg-trade-desk.netlify.app'}))).status,403);
    assert.equal((await s.handler(request({op:'control'},{'x-tradedesk-journal-token':'b'.repeat(64)}))).status,401);
    assert.equal((await s.handler(request({op:'query',args:{sql:'SELECT 1'}}))).status,400);
    await assert.rejects(s.journal.reserve(buildPlan(inputs()),'LIVE'),/PAPER_ONLY_JOURNAL/);
    await assert.rejects(s.journal.call('activate'),/INVALID_OPERATION/);
    const flags=await s.pg.query("SELECT count(*)::integer AS n FROM pg_tables WHERE schemaname='tradedesk' AND rowsecurity=true");assert.equal(flags.rows[0].n,6);
    await s.pg.exec('SET ROLE anon');await assert.rejects(s.pg.query('SELECT * FROM tradedesk.td_trades'),/permission denied/);await s.pg.exec('RESET ROLE');
  }finally{await s.pg.close();}
});
test('Real SQL lease fencing, state CAS, durable stop and unique signal protection survive HTTP requests',async()=>{
  const s=await setup();try{
    assert.equal(await s.journal.acquire(),true);
    const next=new RemotePaperJournal({env,fetchFn:s.fetchFn});assert.equal(await next.acquire(),false);
    const plan=buildPlan(inputs());const reserved=await s.journal.reserve(plan,'PAPER');assert.ok(reserved);
    assert.equal(await s.journal.reserve(plan,'PAPER'),null);
    const open=await s.journal.update(reserved,'OPEN');await assert.rejects(s.journal.update(reserved,'OPEN'),/JOURNAL_CONFLICT/);
    await s.journal.diagnostic({observedAt:new Date().toISOString(),readinessError:null,isSubAccount:true,futuresEnabled:true,feesVerified:true,mode:'LIVE',approval:{},balances:[{total:'1000'}]});
    const c=await s.journal.control();assert.equal(c.mode,'PAPER');assert.equal(c.approval,null);assert.equal(c.accountReadiness.balances,undefined);assert.equal(c.accountReadiness.tradePermissionVerified,false);
    const oldLease=s.journal.lease;
    await s.pg.query("UPDATE tradedesk.cycle_lease SET expires_at=clock_timestamp()-interval '1 second'");
    assert.equal(await next.acquire(),true);assert.ok(next.lease.epoch>oldLease.epoch);
    await assert.rejects(s.journal.update(open,'CLOSED',{netZar:'-2'}),/LEASE_LOST/);
    await s.journal.release();assert.equal(await new RemotePaperJournal({env,fetchFn:s.fetchFn}).acquire(),false,'stale release cannot unlock current owner');
    await next.update(open,'CLOSED',{netZar:'-2',netUsdt:'-0.1',feesZar:'.2'});
    const m=await next.metrics('PAPER');assert.equal(m.totalNetZar,'-2');assert.equal(m.dailyNetZar,'-2');assert.equal(m.dailyLossZar,'2');
    await next.stop('OWNER_EMERGENCY_STOP');assert.equal((await next.control()).stopped,true);
    await assert.rejects(next.reserve({...plan,customerOrderId:'new-id',signalTime:'new-signal'},'PAPER'),/EMERGENCY_STOP/);
    assert.ok((await next.events()).some(e=>e.kind==='SUSPENDED'));await next.release();
  }finally{await s.pg.close();}
});
test('Forward observations require a current fenced lease and cannot be backfilled or counted twice',async()=>{
  const s=await setup();try{
    await s.journal.acquire();
    const o={scannedAt:new Date(Date.now()-600000).toISOString(),policyHash:POLICY_HASH,deployId:'test-deploy',data:{result:{mode:'PAPER',reason:'NO_ELIGIBLE_SIGNAL'}}};
    await s.journal.observe(o);await s.journal.observe(o);
    const f=await s.journal.forward();assert.equal(f.observations,1);assert.equal(f.calendar_days,1);assert.ok(f.started_at);assert.ok(Date.parse(f.started_at)>Date.parse(o.scannedAt)+500000,'trial starts at recording time, not the earlier signal time');
    await assert.rejects(s.journal.observe({...o,scannedAt:new Date(Date.now()-86400000).toISOString()}),/STALE_OBSERVATION/);
    await assert.rejects(s.journal.observe({...o,scannedAt:new Date(Date.now()+60000).toISOString()}),/STALE_OBSERVATION/);
    await s.journal.release();await assert.rejects(s.journal.observe({...o,scannedAt:new Date().toISOString()}),/INVALID_ARGUMENT/);
  }finally{await s.pg.close();}
});

test('Paper service trigger is production-only and requires the restricted remote adapter',()=>{
  const request=value=>new Request('https://mrg-trade-desk.netlify.app/.netlify/functions/tradedesk-trading-cycle-background',{headers:{'x-tradedesk-paper-token':value}});
  assert.equal(verifyPaperTrigger(request(token),{...env,CONTEXT:'production'}),true);
  assert.equal(verifyPaperTrigger(request('b'.repeat(64)),{...env,CONTEXT:'production'}),false);
  assert.equal(verifyPaperTrigger(request(token),{...env,CONTEXT:'deploy-preview'}),false);
  assert.equal(verifyPaperTrigger(request(token),{...env,CONTEXT:'production',TRADEDESK_JOURNAL_URL:'https://untrusted.example'}),false);
});

test('Production postgres.js JSON serializers preserve structured journal payloads in PostgreSQL',async()=>{
  const sql=postgres({types:journalJsonTypes,max:1}),pg=new PGlite();
  try{
    for(const oid of [114,3802])for(const payload of [{plan:{quantity:'0.02',stop:'98'},simulated:true},[{reason:'NO_SIGNAL',mode:'PAPER'}],{result:{mode:'PAPER',reason:'NO_ELIGIBLE_SIGNAL'},proof:{markets:[]}}]){
      const wire=sql.options.serializers[oid](JSON.stringify(payload));
      const row=(await pg.query('SELECT $1::jsonb AS payload,jsonb_typeof($1::jsonb) AS kind',[wire])).rows[0];
      assert.deepEqual(row.payload,payload);assert.notEqual(row.kind,'string');
    }
  }finally{await sql.end();await pg.close();}
});
