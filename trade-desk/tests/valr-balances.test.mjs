import test from "node:test";
import assert from "node:assert/strict";
import { signValr, handleRequest } from "../../netlify/functions/tradedesk-valr-balances.mjs";

const API_KEY="a".repeat(64);
const API_SECRET="b".repeat(64);
const OWNER="Q".repeat(48);
const ENV={TRADEDESK_VALR_API_KEY:API_KEY,TRADEDESK_VALR_API_SECRET:API_SECRET,TRADEDESK_OWNER_TOKEN:OWNER};
const url="https://mrg-trade-desk.netlify.app/.netlify/functions/tradedesk-valr-balances";
const makeRequest=(method="POST",token=OWNER,origin="https://mrg-trade-desk.netlify.app")=>
  new Request(url,{method,headers:{"Authorization":"Bearer "+token,"Origin":origin}});
const decode=async response=>({status:response.status,headers:response.headers,body:await response.json()});

test("VALR documentation's HMAC SHA512 test vector",()=>{
  const actual=signValr("4961b74efac86b25cce8fbe4c9811c4c7a787b7a5996660afcc2e287ad864363",
    "1558014486185","GET","/v1/account/balances");
  assert.equal(actual,"9d52c181ed69460b49307b7891f04658e938b21181173844b5018b2fe783a6d4c62b8e67a03de4d099e7437ebfabe12c56233b73c6a0cc0f7ae87e05f6289928");
});

test("Missing server secrets fail closed",async()=>{
  const r=await decode(await handleRequest(makeRequest(),""));
  assert.equal(r.status,503);
  assert.equal(r.body.error,"NOT_CONFIGURED");
});

test("Only POST accepted, without making an upstream request",async()=>{
  const r=await decode(await handleRequest(makeRequest("GET"),ENV,()=>{throw Error("Should not call VALR");}));
  assert.equal(r.status,405);
});

test("Owner password mandatory and verified before any VALR call",async()=>{
  const r=await decode(await handleRequest(makeRequest("POST","WrongOwnerPassword"),ENV,()=>{throw Error("Should not call VALR");}));
  assert.equal(r.status,401);
  assert.equal(r.body.error,"ACCESS_DENIED");
});

test("Third-party browser origins denied",async()=>{
  const r=await decode(await handleRequest(makeRequest("POST",OWNER,"https://another.site.example"),ENV,()=>{throw Error("Should not call VALR");}));
  assert.equal(r.status,403);
});

test("Read-only signature, request path, filtered balances and no secret disclosure",async()=>{
  let called=false;
  const result=await decode(await handleRequest(makeRequest(),ENV,async(path,options)=>{
    called=true;
    assert.equal(path,"https://api.valr.com/v1/account/balances");
    assert.equal(options.method,"GET");
    assert.equal(options.headers["X-VALR-API-KEY"],API_KEY);
    assert.equal(options.headers["X-VALR-SIGNATURE"],signValr(API_SECRET,"1600000000000","GET","/v1/account/balances"));
    return {ok:true, json:async()=>[
      {currency:"ZAR",available:"0.00",total:"0.00",reserved:"0.00",internalSecret:"should never be sent"},
      {currency:"USDC",available:"12.50000",total:"15.00",reserved:"2.50"},
      {currency:"<script>",total:"10"},
    ]};
  },()=>1600000000000));
  assert.equal(called,true);
  assert.equal(result.status,200);
  assert.equal(result.headers.get("cache-control"),"private, no-store, max-age=0");
  assert.equal(result.body.mode,"READ_ONLY");
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.balances)),[
    {currency:"ZAR",available:"0.00",total:"0.00",reserved:"0.00"},
    {currency:"USDC",available:"12.50000",total:"15.00",reserved:"2.50"},
  ]);
  assert.ok(!JSON.stringify(result.body).includes(API_KEY));
  assert.ok(!JSON.stringify(result.body).includes(API_SECRET));
  assert.ok(!JSON.stringify(result.body).includes(OWNER));
  assert.ok(!JSON.stringify(result.body).includes("internalSecret"));
});

test("VALR auth errors do not expose upstream response",async()=>{
  const r=await decode(await handleRequest(makeRequest(),ENV,async()=>({ok:false,status:401}),()=>1600000000000));
  assert.equal(r.status,502);
  assert.equal(r.body.error,"VALR_AUTH_FAILED");
});

test("Network errors show generic error only",async()=>{
  const r=await decode(await handleRequest(makeRequest(),ENV,async()=>{throw Error("Sensitive upstream diagnostics");}));
  assert.equal(r.status,502);
  assert.ok(!JSON.stringify(r.body).includes("Sensitive"));
});
