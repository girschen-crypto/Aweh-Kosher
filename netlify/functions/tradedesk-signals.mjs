/** Read-only private signal dashboard API. No broker or trade actions. */
import { storeForSignals, runSignalCycle } from "./tradedesk-signal-cycle.mjs";
import { allowedOrigin, verifyOwnerToken, validSession } from "./_shared/tradedesk-passkey-session.mjs";
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff","Vary":"Authorization, Cookie"};
function response(code,body){return new Response(JSON.stringify(body),{status:code,headers:H});}
export function readableSnapshot(snapshot,at){
  const age=at-Date.parse(snapshot.scannedAt);
  const stale=!Number.isFinite(age)||age< -60000||age>20*60000;
  return {...snapshot,stale,snapshotAgeSeconds:Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):null,
    ...(stale?{error:"Signal scan is out of date. Waiting for a fresh scheduled scan.",newSignalCount:0,
      results:(snapshot.results||[]).map(m=>({...m,direction:"WAIT",entry:null,stop:null,target:null,
        marginR:null,notionalR:null,executable:false,reason:"Out-of-date scan; no current signal"}))}:{}),
  };
}
export async function handleSignals(request,env=process.env,store,fetchFn=fetch,now=Date.now){
  if(request.method!=="POST")return response(405,{ok:false,error:"METHOD_NOT_ALLOWED"});
  if(!allowedOrigin(request))return response(403,{ok:false,error:"ORIGIN_REJECTED"});
  let data;
  try{data=await request.json();}catch{return response(400,{ok:false,error:"BAD_REQUEST"});}
  if(!["latest","scan"].includes(data?.action))return response(400,{ok:false,error:"INVALID_ACTION"});
  // Public signals are derived only from public exchange data. Manual scans are owner-only.
  if(data.action==="scan"&&!verifyOwnerToken(request,env)&&!validSession(request,env))
    return response(401,{ok:false,error:"SIGN_IN_REQUIRED"});
  try{
    store ||= storeForSignals();
    let snapshot=await store.get("snapshot",{type:"json",consistency:"strong"});
    if(data.action==="scan"){
      // Avoid repeated VALR requests and Netlify compute consumption.
      const age=snapshot?.scannedAt?now()-Date.parse(snapshot.scannedAt):Infinity;
      if(!Number.isFinite(age)||age<0||age>180000){
        await runSignalCycle({store,fetchFn,now:now()});
        snapshot=await store.get("snapshot",{type:"json",consistency:"strong"});
      }
    }
    if(!snapshot)return response(200,{ok:true,initialized:false,
      message:"Waiting for the first automatic scan. The owner can also sign in and choose Scan now.",budgetZar:200});
    return response(200,{ok:true,initialized:true,snapshot:readableSnapshot(snapshot,now())});
  }catch{
    return response(503,{ok:false,error:"SIGNAL_SCANNER_UNAVAILABLE"});
  }
}
export default async function(request){return handleSignals(request);}
