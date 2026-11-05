/** Read-only private signal dashboard API. No broker or trade actions. */
import { storeForSignals, runSignalCycle } from "./tradedesk-signal-cycle.mjs";
import { allowedOrigin, verifyOwnerToken, validSession } from "./_shared/tradedesk-passkey-session.mjs";
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff","Vary":"Authorization, Cookie"};
function response(code,body){return new Response(JSON.stringify(body),{status:code,headers:H});}
export async function handleSignals(request,env=process.env,store=storeForSignals(),fetchFn=fetch,now=Date.now){
  if(request.method!=="POST")return response(405,{ok:false,error:"METHOD_NOT_ALLOWED"});
  if(!allowedOrigin(request))return response(403,{ok:false,error:"ORIGIN_REJECTED"});
  if(!verifyOwnerToken(request,env)&&!validSession(request,env))return response(401,{ok:false,error:"SIGN_IN_REQUIRED"});
  let data;
  try{data=await request.json();}catch{return response(400,{ok:false,error:"BAD_REQUEST"});}
  if(!["latest","scan"].includes(data?.action))return response(400,{ok:false,error:"INVALID_ACTION"});
  try{
    let snapshot=await store.get("snapshot",{type:"json",consistency:"strong"});
    if(data.action==="scan"){
      // Avoid repeated VALR requests and Netlify compute consumption.
      const age=snapshot?.scannedAt?now()-Date.parse(snapshot.scannedAt):Infinity;
      if(!Number.isFinite(age)||age>180000){
        await runSignalCycle({store,fetchFn,now:now()});
        snapshot=await store.get("snapshot",{type:"json",consistency:"strong"});
      }
    }
    if(!snapshot)return response(200,{ok:true,initialized:false,
      message:"First scheduled scan has not completed. Choose Scan now.",budgetZar:200});
    return response(200,{ok:true,initialized:true,snapshot});
  }catch{
    return response(503,{ok:false,error:"SIGNAL_SCANNER_UNAVAILABLE"});
  }
}
export default async function(request){return handleSignals(request);}
