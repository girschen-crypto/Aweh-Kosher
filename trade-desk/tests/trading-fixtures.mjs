export const NOW=Date.now();
export function inputs(overrides={}){
  const at=new Date(NOW).toISOString();return {
    signal:{pair:"SOLUSDTPERP",direction:"LONG",time:at,entry:100,stop:98,target:106},
    spec:{symbol:"SOLUSDTPERP",active:true,currencyPairType:"FUTURE",quoteCurrency:"USDT",minBaseAmount:"0.01",maxBaseAmount:"300",minQuoteAmount:"1",maxQuoteAmount:"50000",tickSize:"0.01",baseDecimalPlaces:"2"},
    book:{bid:"99.99",ask:"100.01",askDepth:"100",bidDepth:"100",changedAt:at,observedAt:at},
    fx:{bid:"16",ask:"16.01",observedAt:at},feeRate:"0.0007",fundingRate:"0.00001",now:NOW,account:{},...overrides};
}
