import { readFile,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { MARKETS,evaluateMarket } from "../../netlify/functions/_shared/tradedesk-radar.mjs";
import { buildPlan,LIMITS,POLICY_HASH,lossGuard,daySast } from "../../netlify/functions/_shared/tradedesk-trading-policy.mjs";
export function backtest(dataset,{from=Date.parse(dataset.start),to=Date.parse(dataset.end),enforceSuspensions=true,detector=evaluateMarket}={}){
  const series=dataset.data,fxMap=new Map(series.USDTZAR.map(c=>[c.time,c]));
  const maps=Object.fromEntries(MARKETS.map(p=>[p,new Map(series[p].map((c,i)=>[c.time,{c,i}]))]));
  const timeline=[...new Set(MARKETS.flatMap(p=>series[p].map(c=>c.time)))].filter(t=>t>=from&&t<to).sort((a,b)=>a-b);
  let equity=200,peak=200,maxDD=0,dailyLoss=0,lossesInRow=0,active=null,day=null,halt=null;
  const trades=[],rejections={};
  const reject=reason=>{rejections[reason]=(rejections[reason]||0)+1;};
  const close=(bar,time,reason)=>{
    const p=active.plan,long=p.direction==="LONG",qty=Number(p.quantity),entry=Number(p.entry);
    const exitAt=reason==="TIME_LIMIT"?time:time+900000;
    let reference=reason==="STOP"?(long?Math.min(Number(p.stop),bar.open):Math.max(Number(p.stop),bar.open)):
      reason==="TARGET"?Number(p.target):reason==="TIME_LIMIT"?bar.open:bar.close;
    const exit=reference*(long?1-LIMITS.slippagePerSide:1+LIMITS.slippagePerSide);
    const fees=(entry+exit)*qty*Number(p.feeRate),funding=(dataset.funding[p.pair]||[])
      .filter(x=>Date.parse(x.fundingTime)>active.openedAt&&Date.parse(x.fundingTime)<=exitAt)
      .reduce((s,x)=>s+Math.abs(Number(x.fundingRate))*entry*qty,0);
    const gross=(long?exit-entry:entry-exit)*qty,fx=(fxMap.get(time)||fxMap.get(active.openedAt)).close;
    const net=(gross-fees-funding)*fx,slippage=(Math.abs(entry-active.reference)+Math.abs(exit-reference))*qty;
    equity+=net;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);
    if(net<0){dailyLoss-=net;lossesInRow++;}else lossesInRow=0;
    trades.push({pair:p.pair,direction:p.direction,openedAt:new Date(active.openedAt).toISOString(),closedAt:new Date(exitAt).toISOString(),
      quantity:p.quantity,entry,exit,stop:p.stop,target:p.target,reason,netZar:net,costsZar:(fees+funding+slippage)*fx,feesZar:fees*fx,fundingZar:funding*fx,fxZar:fx});active=null;
  };
  for(const time of timeline){
    const currentDay=daySast(time);if(day!==currentDay){day=currentDay;dailyLoss=0;}
    if(active){const found=maps[active.plan.pair].get(time);if(!found){halt="DATA_GAP_WITH_OPEN_POSITION";break;}
      const b=found.c,long=active.plan.direction==="LONG",stop=long?b.low<=Number(active.plan.stop):b.high>=Number(active.plan.stop),
        target=long?b.high>=Number(active.plan.target):b.low<=Number(active.plan.target);
      if(time-active.openedAt>=LIMITS.maxHoldingHours*3600000)close(b,time,"TIME_LIMIT");
      else if(stop||target)close(b,time,stop?"STOP":"TARGET");
      // An exit during this bar cannot finance another entry at the same bar's opening price.
      continue;
    }
    if(active)continue;
    const guard=lossGuard({equityZar:equity,peakEquityZar:peak,dailyLossZar:dailyLoss,consecutiveLosses:lossesInRow});
    if(guard&&enforceSuspensions){halt=guard;break;}
    // Conservative selection: fixed watchlist order, at most one portfolio position.
    for(const pair of MARKETS){
      const found=maps[pair].get(time);if(!found||found.i<60)continue;
      const history=series[pair].slice(Math.max(0,found.i-100),found.i);
      const signal=detector(pair,history,time+10000);if(signal.direction==="WAIT")continue;
      const market=dataset.proof.markets.find(x=>x.pair===pair),fxCandle=fxMap.get(time);
      if(!market?.spec||!fxCandle){reject("MISSING_SPEC_OR_FX");continue;}
      const reference=found.c.open,halfSpread=.0005;
      const plan=buildPlan({signal,spec:market.spec,
        book:{bid:reference*(1-halfSpread),ask:reference*(1+halfSpread),askDepth:100000000,bidDepth:100000000},
        fx:{ask:fxCandle.open*1.0001,bid:fxCandle.open*.9999},feeRate:"0.0007",fundingRate:"0.0001",
        account:{equityZar:equity,peakEquityZar:enforceSuspensions?peak:equity,dailyLossZar:enforceSuspensions?dailyLoss:0,consecutiveLosses:enforceSuspensions?lossesInRow:0},
        now:time+10000,historical:true});
      if(!plan.approved){reject(plan.reason);continue;}
      active={plan,openedAt:time,reference};
      // Opening bar is evaluated only after the decision made using prior closed candles.
      const b=found.c,long=plan.direction==="LONG";
      const stop=long?b.low<=Number(plan.stop):b.high>=Number(plan.stop),target=long?b.high>=Number(plan.target):b.low<=Number(plan.target);
      if(stop||target)close(b,time,stop?"STOP":"TARGET");break;
    }
  }
  if(active){const last=series[active.plan.pair].filter(c=>c.time<to).at(-1);close(last,last.time,"END_OF_SAMPLE");}
  const wins=trades.filter(t=>t.netZar>0),losses=trades.filter(t=>t.netZar<0),sum=(a,k)=>a.reduce((s,t)=>s+t[k],0);
  return {trades:trades.length,winRate:trades.length?wins.length/trades.length:null,netZar:(equity-200).toFixed(4),returnPercent:((equity/200-1)*100).toFixed(4),
    maxDrawdownZar:maxDD.toFixed(4),averageWinZar:wins.length?(sum(wins,"netZar")/wins.length).toFixed(4):null,
    averageLossZar:losses.length?(sum(losses,"netZar")/losses.length).toFixed(4):null,costsZar:sum(trades,"costsZar").toFixed(4),
    feesZar:sum(trades,"feesZar").toFixed(4),fundingZar:sum(trades,"fundingZar").toFixed(4),
    profitFactor:losses.length?(sum(wins,"netZar")/-sum(losses,"netZar")).toFixed(4):null,halt,rejections,journal:trades};
}
export async function makeReport(input,output){
  const raw=await readFile(input,"utf8"),dataset=JSON.parse(raw),start=Date.parse(dataset.start),end=Date.parse(dataset.end),split=start+9*86400000;
  const results={training:backtest(dataset,{from:start,to:split}),holdout:backtest(dataset,{from:split,to:end}),
    diagnosticWithoutSuspensions:backtest(dataset,{from:start,to:end,enforceSuspensions:false})};
  const report={generatedAt:new Date().toISOString(),period:{start:dataset.start,trainingEnds:new Date(split).toISOString(),end:dataset.end},
    datasetSha256:createHash("sha256").update(raw).digest("hex"),candleCounts:Object.fromEntries(Object.entries(dataset.data).map(([p,c])=>[p,c.length])),
    policy:LIMITS,policyHash:POLICY_HASH,capitalAssessment:dataset.proof.markets.filter(x=>x.minimum).map(x=>x.minimum),fxAtAssessment:dataset.proof.fx,
    readyForLive:false,forwardTestDays:0,exchangeProtectionConfirmed:false,
    summary:`14-day model: holdout ${results.holdout.trades} trades, net R${results.holdout.netZar}, suspension: ${results.holdout.halt||"none"}. Live activation blocked; positive returns have not been established.`,
    assumptions:{feePerSide:"0.07% published tier-1 estimate, not verified personal fees",spread:"10 basis points assumed historical spread",slippage:"5 basis points per side",
      funding:"Actual hourly funding magnitudes charged conservatively; funding credits ignored",priceBasis:"VALR mark-price OHLC; actual historical executable spread and depth unavailable",
      fx:"Historical USDTZAR candles; 1bp FX buffer for sizing",exitPriority:"Stop first if target and stop touch the same candle",minimums:"Current exchange minimums applied to historical periods",
      suspensions:"Risk-limited training/holdout suspend at daily loss, drawdown or 3 consecutive losses; diagnostic intentionally ignores suspensions to examine sample quality",
      drawdown:"Closed-trade equity drawdown; intrabar mark-to-market drawdown is not established by these results"},
    results};
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,results:Object.fromEntries(Object.entries(results).map(([k,{journal,...v}])=>[k,v]))},null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await makeReport(process.argv[2]||"/tmp/tradedesk-research/history.json",process.argv[3]||"trade-desk/app/trading-validation.json");
