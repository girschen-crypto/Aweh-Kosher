# Mr G Trade Desk v15

Broker-independent personal decision-support dashboard.

## Architecture

1. Fundamental Analyst
2. Technical Analyst
3. Risk Manager
4. Portfolio Manager
5. `trade-desk/signal.json` is the contract consumed by the PWA.
6. User approves every live brokerage order.

Current broker hand-off: EasyEquities (default) or IBKR Client Portal. IBKR API execution stays disabled until the signal engine is proven with tracked results.

The PWA deliberately refuses to invent missing agent opinions. If `signal.json` does not contain all four agent outputs, the UI marks the engine as WAITING/PARTIAL.


## Opportunity Radar (October 2026)
- Public Binance **Spot** ticker and hourly candles. Screens liquid USDT pairs using spread, turnover, volume ratio, 20-hour breakout, short trend and RSI. A screen score is **not** a probability of profit.
- US-company watchlist uses **delayed/unofficial Stooq end-of-day** CSV. It does not represent executable live stock prices. Queries Google News RSS for possible headline leads; articles and facts have **not** been verified.
- There is currently **no reliable JSE automated pricing feed**. Never represent JSE tickers as scanned.
- `trade-desk/scripts/radar_scan.py` writes `trade-desk/market-radar.json`; a free GitHub Actions workflow runs every three hours, subject to Actions scheduling and the availability/terms of public sources. Open the GitHub Actions tab to run manually.
- The app `trade-desk/app/index.html` fetches the **published** public JSON file. Until a real run succeeds, the placeholder is explicitly stale. More than six hours after a scan, the screen warns that all results are stale.
- Recommended practice: verify actual exchange liquidity, current news, company filings, slippage, brokerage fees and risk/reward **before** considering a trade. A screen does not authorize an investment.
- No API keys are stored or used, no browser-side trade credentials, and no automated orders/transfers. The $5 display is a *hypothetical pilot size*, not a live instruction or proof of account balance.
- Existing Netlify site `mrg-trade-desk` has a **manual drop deployment**. GitHub changes alone do **not** publish the updated dashboard. Link the existing Netlify project to GitHub `girschen-crypto/Aweh-Kosher`, branch `main`, base directory blank, build command blank, publish directory `trade-desk/app`; verify the first deployment before relying on it.
- If scheduled feeds fail, the prior snapshot will become stale rather than silently recommending old opportunities.
