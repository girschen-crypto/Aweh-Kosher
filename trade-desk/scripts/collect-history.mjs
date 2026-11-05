// Read-only reproducible exchange research. Never imports private credentials.
import { mkdir,writeFile,readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MARKETS,normaliseCandles } from "../../netlify/functions/_shared/tradedesk-radar.mjs";
import { publicJSON,collectMarketProof } from "../../netlify/functions/_shared/tradedesk-valr-market.mjs";
const folder=process.argv[2]||"/tmp/tradedesk-research";
await mkdir(folder,{recursive:true});
const end=Math.floor((Date.now()-60000)/900000)*900000,start=end-14*86400000;
let proof;try{proof=JSON.parse(await readFile(folder+"/market-proof.json","utf8"));}catch{proof=await collectMarketProof();}
await writeFile(folder+"/market-proof.json",JSON.stringify(proof,null,2));
const jobs=[];
for(const pair of [...MARKETS,"USDTZAR"]){
  for(let from=start;from<end;from+=86400000){const to=Math.min(end,from+86400000);
    const route=pair==="USDTZAR"?`${pair}/buckets?periodSeconds=900&includeEmpty=true&limit=300&startTime=${from/1000}&endTime=${to/1000}`:
      `${pair}/markprice/buckets?periodSeconds=900&startTime=${new Date(from).toISOString()}&endTime=${new Date(to).toISOString()}`;
    jobs.push({pair,route,from,to});
  }
}
const data=Object.fromEntries([...MARKETS,"USDTZAR"].map(p=>[p,[]]));
let next=0,completed=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function historicalJSON(route){
  for(let attempt=0;attempt<5;attempt++){
    try{const d=await publicJSON(route,fetch,45000);await wait(2200);return d;}
    catch(e){if(e.status!==429&&e.name!=="TimeoutError"||attempt===4)throw e;const seconds=Math.min(60,Math.max(30,e.retryAfter||30));console.log("Public history temporarily limited; waiting",seconds,"seconds");await wait(seconds*1000);}
  }
}
async function worker(){while(next<jobs.length){const job=jobs[next++];
  const file=folder+"/chunk-"+job.pair+"-"+job.from+".json";
  let raw;try{raw=JSON.parse(await readFile(file,"utf8"));}catch{
    raw=await historicalJSON(job.route);await writeFile(file,JSON.stringify(raw));
  }
  const normalized=normaliseCandles(raw,end+60000).filter(c=>c.time>=job.from&&c.time<job.to);
  if(!normalized.length)throw Error("NO_HISTORICAL_DATA:"+job.pair+":"+job.from);
  data[job.pair].push(...normalized);completed++;
  if(completed%10===0)console.log("History batches",completed,"/",jobs.length);
}}
await worker();
for(const p of Object.keys(data))data[p]=[...new Map(data[p].map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
const funding={};
for(const pair of MARKETS){funding[pair]=[];for(let skip=0;skip<600;skip+=100){
  const page=await historicalJSON(`futures/funding/history?currencyPair=${pair}&limit=100&skip=${skip}`);
  if(!Array.isArray(page))throw Error("BAD_FUNDING_HISTORY");funding[pair].push(...page.filter(x=>Date.parse(x.fundingTime)>=start&&Date.parse(x.fundingTime)<=end));
  if(page.length<100||page.some(x=>Date.parse(x.fundingTime)<start))break;
}}
const dataset={collectedAt:new Date().toISOString(),start:new Date(start).toISOString(),end:new Date(end).toISOString(),proof,data,funding};
const text=JSON.stringify(dataset);await writeFile(folder+"/history.json",text);
console.log(JSON.stringify({file:folder+"/history.json",sha256:createHash("sha256").update(text).digest("hex"),counts:Object.fromEntries(Object.entries(data).map(([p,c])=>[p,c.length]))}));
