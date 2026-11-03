# Mr G TradeDesk — Signals Only

**Product decision (3 November 2026):** TradeDesk focuses exclusively on futures-style trading signals. The old multi-market investment dashboard, stock watchlists, equity broker selectors, public-market radar, and unattended spot paper-cycle are no longer part of the visible application.

## One supported workflow

1. Paste a futures signal such as `ETT/USDT`, market order, LONG, 100×, allocation 10%.
2. The local parser extracts pair, leverage, direction, position allocation, and order type. It does not discover market opportunities or create its own signals.
3. Enter a **hypothetical** balance, per-contract margin, entry price and fee estimate. These are assumptions, NOT verified exchange terms.
4. Review estimated whole contracts, used margin, notional exposure, two-sided fees and 0.5% movement scenarios.
5. Optionally open a **paper-only** position, manually check a new hypothetical price, and close it in the local trade journal. Virtual positive net P/L goes into a separate virtual reserve rather than being reinvested.
6. Stop-loss and target controls are optional **manual checks only**, not actual exchange protection or monitoring.

### Example based on user's supplied Vantera message

- Account example: 200 USDT; position size: 10% → 20 USDT planned margin
- Margin per unit: **assumed** 10 USDT → two whole contracts
- Leverage: 100× → **assumed** 2,000 USDT notional exposure
- Estimated fee: **assumed** 0.25 USDT per contract per side → 1 USDT round-trip
- +0.5% favourable market movement → ~+9 USDT **illustrative** net P/L
- −0.5% adverse movement → ~−11 USDT **illustrative** net P/L

Actual liquidation, slippage, funding, insurance funds, position sizes and rules depend on the venue and instrument. At 100× an adverse move of approximately 1% can exhaust the margin, and liquidation can occur earlier. Never infer a verified market or withdrawable profits from the Vantera screenshot. Binance's USDⓈ-M ticker API rejected `ETTUSDT` and `CLSUSDT` during a read-only check; these symbols are **not automatically portable** to Binance.

## Code and operating status

- Main app homepage: `trade-desk/app/index.html`, using `futures-lab.js` only.
- Legacy `futures-lab.html` redirects to the same new homepage.
- Offline cache: `trade-desk/app/sw.js`, caches only signal-related files.
- Source of signal: **user-pasted text**, not an exchange feed or bot's prediction.
- Data: browser-local storage under `mrgTradeDeskFuturesLabV1`; it does **not** sync to an account or broker.
- No real funds, deposits, broker credentials, broker account connection, real order placement, cash withdrawals, realtime market feeds, background monitoring or exchange-native stops.
- No unrelated equity or spot-crypto investment screens remain in the homepage.
- Legacy scanning/spot engine source files remain in Git history and/or unused source paths for reversibility, but the two GitHub Actions scheduled workflows `tradedesk-radar.yml` and `tradedesk-auto-cycle.yml` were removed from the branch.
- TradeDesk operations must only work with user-provided futures trading signals. Do **not** automatically restore or run the earlier market scans and share investment features.

## Test and publish

Run `node trade-desk/tests/futures-lab.test.cjs` in a clone of the repository. Tests cover position sizing, fees, LONG/SHORT parsing, virtual closing and the signal-only homepage.

**Deployment note:** The existing Netlify project `mrg-trade-desk` currently has a manual drop deployment, not continuous Git builds. Merging source updates is not a live production publish. To publish the signal-only version, deploy `trade-desk/app` to the same existing Netlify project or connect that project to branch `main` with publish directory `trade-desk/app`. No new paid service is required.

The earlier multi-asset TradeDesk and detailed development history are preserved by Git commits, not by maintaining duplicate user-facing features.
