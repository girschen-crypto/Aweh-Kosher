// Fixed server journal API: no arbitrary SQL, broker access, live mode or activation endpoint.
const H={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const response=(status,data)=>new Response(JSON.stringify(data,(_,v)=>typeof v==="bigint"?String(v):v),{status,headers:H});
const error=code=>{throw Error(code);};
const str=(v,n=120)=>{if(typeof v!=="string"||!v.length||v.length>n)error("INVALID_ARGUMENT");return v;};
const paper=mode=>{if(mode!=="PAPER")error("PAPER_ONLY_JOURNAL");};
const states=new Set(["RESERVED","OPEN","CLOSED","CANCELLED","REJECTED"]);
export async function digest(token){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function equal(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export function journalHandler(db){return async request=>{
  if(request.method!=="POST"||request.headers.has("Origin"))return response(403,{ok:false,error:"SERVER_ONLY"});
  const token=request.headers.get("x-tradedesk-journal-token")||"";
  if(!/^[a-f0-9]{64}$/.test(token))return response(401,{ok:false,error:"UNAUTHORISED"});
  try{
    const secrets=await db.query("SELECT sha256 FROM tradedesk.runtime_secrets WHERE name='netlify-paper-journal'",[]);
    if(!secrets[0]||!equal(await digest(token),secrets[0].sha256))return response(401,{ok:false,error:"UNAUTHORISED"});
    if(Number(request.headers.get("Content-Length")||0)>65536)return response(413,{ok:false,error:"BODY_TOO_LARGE"});
    // Bound streaming reads, including callers which omit Content-Length.
    const reader=request.body?.getReader();let size=0;const chunks=[];
    if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return response(413,{ok:false,error:"BODY_TOO_LARGE"});}chunks.push(value);}}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return response(400,{ok:false,error:"INVALID_JSON"});}
    if(!body||typeof body!=="object"||Array.isArray(body))return response(400,{ok:false,error:"INVALID_ARGUMENT"});
    const {op,args={}}=body;
    const query=(q,p=[])=>db.query(q,p);
    const fenced=fn=>db.transaction(async tx=>{
      const rows=await tx.query("SELECT id FROM tradedesk.cycle_lease WHERE id=1 AND owner=$1 AND epoch=$2 AND expires_at>clock_timestamp() FOR UPDATE",[str(body.lease?.owner),body.lease?.epoch]);
      if(rows.length!==1)error("LEASE_LOST");return fn(tx.query.bind(tx));
    });
    let result;
    switch(op){
      case "acquire": {
        const rows=await query("UPDATE tradedesk.cycle_lease SET owner=$1,epoch=epoch+1,expires_at=clock_timestamp()+interval '5 minutes' WHERE id=1 AND expires_at<=clock_timestamp() RETURNING owner,epoch",[str(args.owner)]);
        result=rows[0]||null;break;
      }
      case "release": await query("UPDATE tradedesk.cycle_lease SET owner=NULL,expires_at='-infinity' WHERE id=1 AND owner=$1 AND epoch=$2",[str(body.lease?.owner),body.lease?.epoch]);result=true;break;
      case "control": {
        result=(await query("SELECT data FROM tradedesk.td_control WHERE id=1"))[0]?.data;
        if(!result||result.mode!=="PAPER")error("PAPER_ONLY_JOURNAL");break;
      }
      case "diagnostic": {
        const d=args.data;
        if(!d||!Number.isFinite(Date.parse(d.observedAt))||typeof d.readinessError!=="string"&&d.readinessError!==null)error("INVALID_ARGUMENT");
        const projection={observedAt:d.observedAt,readinessError:d.readinessError,isSubAccount:d.isSubAccount===true,futuresEnabled:d.futuresEnabled===true,feesVerified:d.feesVerified===true,tradePermissionVerified:false};
        result=await fenced(async q=>{await q("UPDATE tradedesk.td_control SET data=jsonb_set(data,'{accountReadiness}',$1::jsonb) WHERE id=1",[JSON.stringify(projection)]);return true;});break;
      }
      case "stop": {
        const reason=str(args.reason);
        result=await db.transaction(async tx=>{
          await tx.query("UPDATE tradedesk.td_control SET data=jsonb_set(jsonb_set(data,'{stopped}','true'),'{stopReason}',to_jsonb($1::text)) WHERE id=1",[reason]);
          await tx.query("INSERT INTO tradedesk.td_events(kind,data) VALUES('SUSPENDED',$1::jsonb)",[JSON.stringify({reason})]);return true;
        });break;
      }
      case "active": {
        paper(args.mode);const rows=await query("SELECT * FROM tradedesk.td_trades WHERE mode='PAPER' AND state NOT IN ('CLOSED','CANCELLED','REJECTED') ORDER BY created_at");
        if(rows.length>1)error("MULTIPLE_ACTIVE_INTENTS");result=rows[0]||null;break;
      }
      case "reserve": {
        paper(args.mode);const p=args.plan;
        if(!p||p.approved!==true||p.mode!=="PAPER"||!/^[a-f0-9]{64}$/.test(p.policyHash||""))error("INVALID_ARGUMENT");
        result=await fenced(async q=>{
          // The stop flag and intent are read/written in one transaction.
          const config=(await q("SELECT data FROM tradedesk.td_control WHERE id=1 FOR UPDATE",[]))[0]?.data;
          if(config?.stopped)error("EMERGENCY_STOP");if(config?.mode!=="PAPER")error("PAPER_ONLY_JOURNAL");
          const rows=await q("INSERT INTO tradedesk.td_trades(id,mode,signal_key,state,data) VALUES($1,'PAPER',$2,'RESERVED',$3::jsonb) ON CONFLICT DO NOTHING RETURNING *",
            [str(p.customerOrderId,50),[str(p.pair),str(p.signalTime),str(p.direction)].join(":"),JSON.stringify({plan:p,beforeUsdt:null,positionId:null,protectionVerified:false})]);return rows[0]||null;
        });break;
      }
      case "update": {
        if(!states.has(args.state)||!states.has(args.from))error("INVALID_ARGUMENT");
        result=await fenced(async q=>{const rows=await q("UPDATE tradedesk.td_trades SET state=$2,data=data||$3::jsonb,updated_at=now(),closed_at=CASE WHEN $2 IN ('CLOSED','CANCELLED','REJECTED') THEN now() ELSE closed_at END WHERE id=$1 AND state=$4 AND mode='PAPER' RETURNING *",
          [str(args.id,50),args.state,JSON.stringify(args.patch||{}),args.from]);if(rows.length!==1)error("JOURNAL_CONFLICT");return rows[0];});break;
      }
      case "event": result=await fenced(async q=>{await q("INSERT INTO tradedesk.td_events(trade_id,kind,data) VALUES($1,$2,$3::jsonb)",[args.tradeId===null?null:str(args.tradeId,50),str(args.kind,60),JSON.stringify(args.data||{})]);return true;});break;
      case "trades": paper(args.mode);result=await query("SELECT * FROM tradedesk.td_trades WHERE mode='PAPER' ORDER BY created_at DESC LIMIT 1000");break;
      case "closed": paper(args.mode);result=await query("SELECT data,closed_at FROM tradedesk.td_trades WHERE mode='PAPER' AND state='CLOSED' ORDER BY closed_at,id LIMIT 10001");if(result.length>10000)error("METRICS_REVIEW_REQUIRED");break;
      case "trade": result=(await query("SELECT * FROM tradedesk.td_trades WHERE id=$1 AND mode='PAPER'",[str(args.id,50)]))[0]||null;break;
      case "events": result=await query("SELECT kind,data,created_at FROM tradedesk.td_events ORDER BY id DESC LIMIT 30");break;
      case "observe": {
        const at=Date.parse(args.scannedAt),now=Date.now();
        if(!Number.isFinite(at)||at>now+30000||now-at>20*60000||!/^[a-f0-9]{64}$/.test(args.policyHash||""))error("STALE_OBSERVATION");
        result=await fenced(async q=>{await q("INSERT INTO tradedesk.forward_observations(scanned_at,policy_hash,deploy_id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(scanned_at) DO NOTHING",
          [new Date(at).toISOString(),args.policyHash,str(args.deployId),JSON.stringify(args.data)]);return true;});break;
      }
      case "forward": {
        result=(await query("SELECT min(scanned_at) AS started_at,max(scanned_at) AS last_observed_at,count(*)::integer AS observations,count(DISTINCT (scanned_at AT TIME ZONE 'Africa/Johannesburg')::date)::integer AS calendar_days FROM tradedesk.forward_observations WHERE policy_hash=$1",[str(args.policyHash,64)]))[0];break;
      }
      default:return response(400,{ok:false,error:"INVALID_OPERATION"});
    }
    return response(200,{ok:true,result});
  }catch(e){const known=["INVALID_ARGUMENT","PAPER_ONLY_JOURNAL","LEASE_LOST","JOURNAL_CONFLICT","EMERGENCY_STOP","MULTIPLE_ACTIVE_INTENTS","STALE_OBSERVATION","METRICS_REVIEW_REQUIRED"];
    return response(503,{ok:false,error:known.includes(e.message)?e.message:"JOURNAL_UNAVAILABLE"});}
};}
