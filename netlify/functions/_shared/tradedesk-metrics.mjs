import Decimal from "decimal.js";
import { daySast,D } from "./tradedesk-trading-policy.mjs";
export function computeMetrics(all,now=Date.now()){
    let equity=D(200),peak=D(200),maxDrawdown=D(0),dailyLoss=D(0),dailyNet=D(0),consecutiveLosses=0,wins=0,losses=0,fees=D(0),netUsdt=D(0);
    const today=daySast(now);
    for(const t of all){const net=D(t.data.netZar);if(daySast(new Date(t.closed_at).getTime())===today)dailyNet=dailyNet.plus(net);equity=equity.plus(net);peak=Decimal.max(peak,equity);maxDrawdown=Decimal.max(maxDrawdown,peak.minus(equity));
      if(net.lt(0)){losses++;consecutiveLosses++;if(daySast(new Date(t.closed_at).getTime())===today)dailyLoss=dailyLoss.minus(net);}else{if(net.gt(0))wins++;consecutiveLosses=0;}
      fees=fees.plus(t.data.feesZar||0);
      netUsdt=netUsdt.plus(t.data.netUsdt||0);
    }
    return {equityZar:equity.toFixed(),peakEquityZar:peak.toFixed(),maxDrawdownZar:maxDrawdown.toFixed(),dailyLossZar:dailyLoss.toFixed(),dailyNetZar:dailyNet.toFixed(),consecutiveLosses,
      totalNetZar:equity.minus(200).toFixed(),totalNetUsdt:netUsdt.toFixed(),trades:all.length,wins,losses,feesZar:fees.toFixed(),winRate:all.length?wins/all.length:null};
}
