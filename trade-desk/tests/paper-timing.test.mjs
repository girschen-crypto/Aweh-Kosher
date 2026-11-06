import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { computeMetrics } from '../../netlify/functions/_shared/tradedesk-metrics.mjs';
import { paperTick } from '../../netlify/functions/_shared/tradedesk-trading-engine.mjs';
function sample({signalTime='2026-11-06T04:00:00.000Z'}={}){
  const trade={id:'paper-timing-test',state:'OPEN',mode:'PAPER',created_at:'2026-11-06T04:00:36.000Z',data:{plan:{pair:'SOLUSDTPERP',direction:'LONG',signalTime,entry:'100',stop:'98',target:'106',quantity:'0.02',feeRate:'0.0007'}}};
  const proof={fx:{bid:'16',ask:'16.01'},markets:[{pair:'SOLUSDTPERP',book:{bid:'100',ask:'100.01'}}]};
  const updates=[];const journal={async update(t,state,patch){updates.push({state,patch});return {...t,state,data:{...t.data,...patch}};}};
  return {trade,proof,journal,updates};
}
test('Paper timeout closes on the two-hour signal-candle boundary despite later database reservation',async()=>{
  const s=sample();const now=Date.parse('2026-11-06T06:00:24.000Z');
  const t=await paperTick(s.trade,{journal:s.journal,proof:s.proof,now});
  assert.equal(t.state,'CLOSED');assert.equal(t.data.exitReason,'TIME_LIMIT');
  assert.equal(t.data.holdingDeadlineAt,'2026-11-06T06:00:00.000Z');
});
test('Paper timeout keeps the position before its deadline and cannot be extended by an invalid signal time',async()=>{
  const early=sample();await paperTick(early.trade,{journal:early.journal,proof:early.proof,now:Date.parse('2026-11-06T05:45:25Z')});assert.equal(early.updates.length,0);
  for(const signalTime of ['not-a-date','2026-11-07T04:00:00Z']){
    const s=sample({signalTime});const t=await paperTick(s.trade,{journal:s.journal,proof:s.proof,now:Date.parse('2026-11-06T06:00:24Z')});
    assert.equal(t.state,'CLOSED');assert.equal(t.data.holdingDeadlineAt,'2026-11-06T06:00:00.000Z');
  }
});
test('Paper close stores reproducible currency accounting and simulation provenance',async()=>{
  const s=sample();s.proof.markets[0].book.bid='97';
  const t=await paperTick(s.trade,{journal:s.journal,proof:s.proof,now:Date.parse('2026-11-06T04:15:25Z')});
  assert.equal(t.data.exitReason,'STOP');assert.equal(t.data.simulated,true);assert.equal(t.data.protectionVerified,false);
  assert.equal(t.data.fxAtExit,'16.01');assert.equal(t.data.simulationVersion,'BOOK_SNAPSHOTS_V2');
  assert.ok(new Decimal(t.data.netUsdt).mul(t.data.fxAtExit).eq(t.data.netZar));
});

test('Legacy paper results without exit USDT are marked incomplete instead of silently counted as zero',()=>{
  const closed_at='2026-11-06T06:00:24Z';
  const mixed=computeMetrics([{closed_at,data:{netZar:'-0.44'}},{closed_at,data:{netZar:'0.16',netUsdt:'0.01'}}]);
  assert.equal(mixed.totalNetZar,'-0.28');assert.equal(mixed.totalNetUsdt,null);assert.equal(mixed.netUsdtComplete,false);
  const complete=computeMetrics([{closed_at,data:{netZar:'0.16',netUsdt:'0.01'}}]);
  assert.equal(complete.totalNetUsdt,'0.01');assert.equal(complete.netUsdtComplete,true);
});
