import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { handlePasskeyRequest } from "../../netlify/functions/tradedesk-passkeys.mjs";
import { handleRequest } from "../../netlify/functions/tradedesk-valr-balances.mjs";

const SITE="https://mrg-trade-desk.netlify.app";
const ENV={TRADEDESK_OWNER_TOKEN:"Z".repeat(48),TRADEDESK_VALR_API_KEY:"a".repeat(64),TRADEDESK_VALR_API_SECRET:"b".repeat(64)};
const b64=b=>Buffer.from(b).toString("base64url");
const hash=b=>createHash("sha256").update(b).digest();
// Minimal CBOR writer for an ES256 virtual authenticator's public attestation.
function head(major,n){
  if(n<24)return Buffer.from([(major<<5)|n]);
  if(n<256)return Buffer.from([(major<<5)|24,n]);
  const b=Buffer.alloc(3);b[0]=(major<<5)|25;b.writeUInt16BE(n,1);return b;
}
function cbor(v){
  if(Number.isInteger(v))return v>=0?head(0,v):head(1,-1-v);
  if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
  if(typeof v==="string"){const b=Buffer.from(v);return Buffer.concat([head(3,b.length),b]);}
  if(v instanceof Map)return Buffer.concat([head(5,v.size),...[...v].flatMap(([k,x])=>[cbor(k),cbor(x)])]);
  throw Error("Unsupported fixture type");
}
function store(){
  const map=new Map();return {
    async getWithMetadata(key){return map.get(key)||null;},
    async setJSON(key,data,opts={}){
      const old=map.get(key);
      if(opts.onlyIfNew&&old||opts.onlyIfMatch&&old?.etag!==opts.onlyIfMatch)return {modified:false};
      map.set(key,{data:structuredClone(data),etag:String(Number(old?.etag||0)+1)});return {modified:true};
    },
  };
}
function request(action,extra={},token="",cookie=""){
  return new Request(SITE+"/.netlify/functions/tradedesk-passkeys",{method:"POST",
    headers:{Origin:SITE,"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify({action,...extra})});
}
test("Real WebAuthn verification registers, signs in, reads a balance by cookie and rejects replay",async()=>{
  const db=store();
  const call=(action,extra={},token="",cookie="")=>handlePasskeyRequest(request(action,extra,token,cookie),ENV,db);
  const begun=await (await call("register-begin",{},ENV.TRADEDESK_OWNER_TOKEN)).json();
  const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const jwk=publicKey.export({format:"jwk"}),id=randomBytes(32),length=Buffer.alloc(2);length.writeUInt16BE(id.length);
  const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,"base64url")],[-3,Buffer.from(jwk.y,"base64url")]]));
  const authenticator=Buffer.concat([hash("mrg-trade-desk.netlify.app"),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),length,id,cose]);
  const client=Buffer.from(JSON.stringify({type:"webauthn.create",challenge:begun.options.challenge,origin:SITE,crossOrigin:false}));
  const credential={id:b64(id),rawId:b64(id),type:"public-key",clientExtensionResults:{},
    response:{clientDataJSON:b64(client),attestationObject:b64(cbor(new Map([["fmt","none"],["attStmt",new Map()],["authData",authenticator]]))),transports:["internal"]}};
  const registration=await call("register-finish",{challengeId:begun.challengeId,credential},ENV.TRADEDESK_OWNER_TOKEN);
  assert.equal(registration.status,200,JSON.stringify(await registration.clone().json()));
  assert.match(registration.headers.get("set-cookie"),/Max-Age=28800/);
  const begin=await (await call("login-begin")).json();
  const loginClient=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:begin.options.challenge,origin:SITE,crossOrigin:false}));
  const counter=Buffer.alloc(4);counter.writeUInt32BE(1);
  const authData=Buffer.concat([hash("mrg-trade-desk.netlify.app"),Buffer.from([0x05]),counter]);
  const signature=sign("sha256",Buffer.concat([authData,hash(loginClient)]),privateKey);
  const login={challengeId:begin.challengeId,credential:{id:b64(id),rawId:b64(id),type:"public-key",clientExtensionResults:{},
    response:{authenticatorData:b64(authData),clientDataJSON:b64(loginClient),signature:b64(signature),userHandle:begun.options.user.id}}};
  const signed=await call("login-finish",login);
  assert.equal(signed.status,200,JSON.stringify(await signed.clone().json()));
  const cookie=signed.headers.get("set-cookie").split(";")[0];
  const status=await (await call("status",{},"",cookie)).json();assert.equal(status.signedIn,true);
  const balance=await handleRequest(new Request(SITE+"/.netlify/functions/tradedesk-valr-balances",{method:"POST",headers:{Origin:SITE,Cookie:cookie}}),ENV,
    async()=>({ok:true,json:async()=>[{currency:"ZAR",available:"200.00",total:"200.00",reserved:"0"}]}));
  assert.equal(balance.status,200);assert.equal((await balance.json()).balances[0].currency,"ZAR");
  assert.equal((await call("login-finish",login)).status,400);
  assert.match((await call("logout")).headers.get("set-cookie"),/Max-Age=0/);
});
