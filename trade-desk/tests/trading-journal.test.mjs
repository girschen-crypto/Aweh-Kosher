import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { TradingJournal } from "../../netlify/functions/_shared/tradedesk-journal.mjs";
import { buildPlan } from "../../netlify/functions/_shared/tradedesk-trading-policy.mjs";
import { inputs } from "./trading-fixtures.mjs";
test("PostgreSQL constraints enforce one active position, idempotency, compare-and-set updates and durable stop state",async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL("../db/001_trading.sql",import.meta.url),"utf8"));
  const client={query:async(sql,values)=>db.query(sql,values)},journal=new TradingJournal(client);
  try{
    const plan=buildPlan(inputs());const first=await journal.reserve(plan,"PAPER");assert.ok(first);
    assert.equal(await journal.reserve(plan,"PAPER"),null);
    assert.equal(await journal.reserve({...plan,customerOrderId:"second",signalTime:"new"},"PAPER"),null);
    const open=await journal.update(first,"OPEN");await assert.rejects(journal.update(first,"OPEN"),/JOURNAL_CONFLICT/);
    await journal.update(open,"CLOSED",{netZar:"-2",netUsdt:"-0.125",feesZar:"0.12"});
    assert.equal((await journal.metrics("PAPER")).totalNetZar,"-2");
    assert.equal((await journal.metrics("PAPER")).consecutiveLosses,1);
    await journal.stop("OWNER_EMERGENCY_STOP");assert.equal((await journal.control()).stopped,true);
    assert.ok(await journal.reserve({...plan,customerOrderId:"third",signalTime:"third"},"PAPER"));
    assert.equal((await new TradingJournal(client).control()).stopReason,"OWNER_EMERGENCY_STOP");
  }finally{await db.close();}
});
