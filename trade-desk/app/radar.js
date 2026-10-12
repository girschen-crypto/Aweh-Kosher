/* TradeDesk Opportunity Radar — research-only; never places an order. */
(() => {
  'use strict';
  const SNAPSHOT = 'https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/main/trade-desk/market-radar.json';
  const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_PILOT_USD = 5;
  let loading = false;

  const node = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g,
    ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatNum = (v, digits=2) => Number.isFinite(Number(v)) ?
    Number(v).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
  const usd = (v, digits=2) => '$' + formatNum(v,digits);
  const positive = n => Number(n) > 0 ? '+' : '';
  const pct = n => positive(n) + formatNum(n,2) + '%';
  const empty = (id, msg) => { if (node(id)) node(id).innerHTML = '<p class="radar-empty">' + safe(msg) + '</p>'; };
  const cleanTicker = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,16);

  function explain(status, item) {
    const tags = [];
    if (item.breakout_20h || item.breakout_20d) tags.push('Breakout observed');
    if (Number(item.volume_ratio) >= 1.5) tags.push('Above-normal volume');
    if (item.above_sma20h || item.above_sma20d) tags.push('Above short trend');
    for (const warning of item.warnings || []) tags.push(warning);
    return tags.join(' · ') || 'Price/volume screen only — no catalyst confirmed';
  }

  function entry(item, market, stale) {
    const ticker = cleanTicker(item.ticker);
    const isCrypto = market === 'crypto';
    const status = safe(item.status || 'MONITOR');
    const flagged = Boolean((item.warnings || []).length);
    const badgeClass = stale || flagged ? 'radar-caution' :
      status.indexOf('BREAKOUT') >= 0 ? 'radar-strong' : 'radar-neutral';
    const price = isCrypto ? usd(item.price_usdt, Number(item.price_usdt) >= 1 ? 2 : 6) : usd(item.price_usd);
    const change = isCrypto ? item.change_24h_pct : item.day_change_pct;
    const priceAsOf = isCrypto ? '24h' : 'Day';
    const volume = formatNum(item.volume_ratio,2) + '× volume';
    const source = isCrypto ? 'Binance Spot' : 'Stooq · daily close ' + (item.as_of || '?');
    const headlines = !isCrypto && Array.isArray(item.headline_leads) ?
      item.headline_leads.filter(h => String(h.url||'').startsWith('https://news.google.com/'))
        .slice(0,2).map(h => '<div class="radar-news"><a href="' + safe(h.url) +
          '" target="_blank" rel="noopener noreferrer">' + safe(h.headline) +
          '</a><small> Google News RSS lead · unverified</small></div>').join('') : '';
    const researchUrl = isCrypto
      ? 'https://www.binance.com/en/trade/' + encodeURIComponent(cleanTicker(item.pair || ticker+'USDT').replace(/USDT$/,'_USDT'))
      : 'https://finance.yahoo.com/quote/' + encodeURIComponent(ticker);
    return '<article class="radar-item">' +
      '<div class="radar-item-head"><strong>' + ticker + '</strong><span class="radar-badge '+ badgeClass +'">' +
      (stale ? 'DATA STALE' : status) + '</span></div>' +
      '<div class="radar-numbers"><b>'+ price +'</b><span>' + priceAsOf + ': ' + pct(change) +
      '</span><span>'+ volume +'</span><span>Screen score '+safe(item.score)+'/100</span></div>' +
      '<p>'+safe(explain(status,item))+'</p><small>' + safe(source) +
      (isCrypto ? ' · 1h closed candles' : ' · not a live quote') + '</small>' +
      headlines + '<div class="radar-actions"><a class="radar-research" href="'+researchUrl+
      '" target="_blank" rel="noopener noreferrer">'+ (isCrypto ? 'Check Binance' : 'Research share') +
      ' ↗</a><span>Research only · no automatic order</span></div>' +
      '</article>';
  }

  function render(payload) {
    const generated = new Date(payload.generated_at || '');
    const generatedMs = generated.getTime();
    const stale = !Number.isFinite(generatedMs) || Date.now() - generatedMs > MAX_SNAPSHOT_AGE_MS ||
      generatedMs - Date.now() > 10*60*1000;
    node('radarUpdated').textContent = Number.isFinite(generatedMs) ?
      'Scanned '+ generated.toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'}) : 'Unknown scan time';
    node('radarStatus').textContent = stale ? 'STALE · RESEARCH ONLY' : 'LATEST PUBLIC SCAN';
    node('radarStatus').className = 'pill ' + (stale ? 'wait' : 'buy');

    const coins = payload.crypto?.data || [];
    const equities = payload.stocks?.data || [];
    if (!Array.isArray(coins) || !coins.length)
      empty('radarCrypto', payload.crypto?.error || 'No crypto candidates passed the liquidity and data checks.');
    else node('radarCrypto').innerHTML = coins.slice(0,8).map(x => entry(x,'crypto',stale)).join('');
    if (!Array.isArray(equities) || !equities.length)
      empty('radarEquities', payload.stocks?.error || 'Equity feed has not returned qualifying daily prices.');
    else node('radarEquities').innerHTML = equities.slice(0,8).map(x => entry(x,'stock',stale)).join('');
    node('radarAlert').textContent = stale ?
      'The public scan is older than six hours. Do not act on these figures. Refresh or verify the quotes directly.' :
      'Rankings are based on price and volume, not forecasts. Research company filings, news, liquidity, fees and downside before buying.';
    node('radarCost').textContent = 'Suggested trial size: ' + usd(DEFAULT_PILOT_USD) +
      ' maximum per researched position, subject to actual available cash and broker minimums. No order is created here.';
  }

  async function refreshRadar(manual=false) {
    if (loading) return;
    loading = true;
    node('radarStatus').textContent = 'FETCHING SCAN';
    node('radarStatus').className = 'pill wait';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);
      let response;
      try {
        response = await fetch(SNAPSHOT + '?v=' + Date.now(), {cache:'no-store',signal:controller.signal});
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error('Snapshot not published (' + response.status + ')');
      const payload = await response.json();
      if (payload.schema_version !== 1 || payload.execution_enabled !== false)
        throw new Error('Unexpected or unsafe scan format');
      render(payload);
      if (manual && window.toast) window.toast('Latest published market scan loaded');
    } catch(err) {
      node('radarStatus').textContent = 'NO VERIFIED SCAN';
      node('radarStatus').className = 'pill wait';
      node('radarUpdated').textContent = 'Not available';
      empty('radarCrypto','Public scan not available yet. No crypto candidates can be verified.');
      empty('radarEquities','Public scan not available yet. No stock candidates can be verified.');
      node('radarAlert').textContent = 'No validated snapshot. Never use old lists or rumours to place a trade.';
      if (manual && window.toast) window.toast('Market scan unavailable');
    } finally {
      loading = false;
    }
  }
  window.refreshOpportunityRadar = refreshRadar;
  if (node('radarCrypto')) refreshRadar(false);
})();
