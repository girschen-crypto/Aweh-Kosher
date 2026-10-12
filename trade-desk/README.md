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
- US-company watchlist first attempts **delayed/unofficial Stooq end-of-day** CSV and then the unofficial Yahoo Finance historical chart feed. If both fail, TradeDesk displays news-only research with **no price or buy signal**. Neither feed represents executable stock prices or a licensed commercial market-data subscription. Queries Google News RSS for possible headline leads; articles and facts have **not** been verified.
- There is currently **no reliable JSE automated pricing feed**. Never represent JSE tickers as scanned.
- `trade-desk/scripts/radar_scan.py` writes a public, research-only JSON snapshot; a free GitHub Actions workflow runs every three hours, subject to Actions scheduling and public-source availability. The workflow publishes updates to branch `tradedesk-radar-data`, **not** the deployed app's `main` branch, to avoid needless Netlify builds. Open GitHub Actions to run manually.
- The app `trade-desk/app/index.html` fetches the public JSON file from branch `tradedesk-radar-data`. Until a real run succeeds, the placeholder is explicitly stale. More than six hours after a scan, the screen warns that all results are stale.
- Recommended practice: verify actual exchange liquidity, current news, company filings, slippage, brokerage fees and risk/reward **before** considering a trade. A screen does not authorize an investment.
- No API keys are stored or used, no browser-side trade credentials, and no automated orders/transfers. The $5 display is a *hypothetical pilot size*, not a live instruction or proof of account balance.
- Existing Netlify site `mrg-trade-desk` has a **manual drop deployment**. GitHub changes alone do **not** publish the updated dashboard. Link the existing Netlify project to GitHub `girschen-crypto/Aweh-Kosher`, branch `main`, base directory blank, build command blank, publish directory `trade-desk/app`; verify the first deployment before relying on it.
- If scheduled feeds fail, the prior snapshot will become stale rather than silently recommending old opportunities.

## Unattended Profit Cycle — PAPER MODE (12 October 2026)

TradeDesk implements the requested signal → invest → exit → recover capital cycle in **paper mode only**. The current code cannot place real-money broker orders:

1. GitHub Actions runs trade-desk/scripts/auto_cycle.py roughly every five minutes (scheduling may be delayed) while the dashboard is closed. It reads Binance Spot public market data and the fresh research snapshot on the tradedesk-radar-data branch.
2. Simulated BUY requires a BREAKOUT WATCH candidate with score ≥80, 20-hour breakout, positive momentum, 24-hour liquidity, abnormal volume, RSI 48–68, spread ≤0.12%, snapshot age under 90 minutes and live quote within 0.5% of the research price. These technical factors do not forecast returns.
3. Starting virtual balance: **25 USDT** (fictional, not the user's brokerage balance). Maximum simulated exposure is 5 USDT and 20% of virtual cash, with a 1% per-trade planned equity-risk cap; no more than one position, two entries per day or 2% daily realised loss.
4. A simulated position exits at a 2% stop, 3.5% target or 24-hour time limit, factoring 0.1% per-side estimated fee and 0.1% per-side slippage. Market gaps over a stop are simulated at the worse observed price. These are scheduled checks, **not exchange-native protective orders**. They are unsafe to substitute for live trading stops.
5. At exit, capital returns to the virtual trading-cash balance. **100% of realised positive net profit** moves into a separate virtual reserve and is not reinvested. Losses reduce trading cash. Neither movement transfers any real money or represents a withdrawal.
6. State and history are saved in trade-desk/auto-cycle-state.json on the tradedesk-radar-data branch to avoid unnecessary Netlify builds. The dashboard reads it through trade-desk/app/auto-cycle.js and clearly labels virtual values.
7. Unit tests cover profits, gaps, stops, signals, stale research, idempotency, risk limits and a strict refusal to enable live orders.

**Live deployment prerequisites:** A trade-enabled broker API (Binance Spot or suitably supported equity broker) and read access to actual account balances and fills; exchange-side contingent exits, reconciliation of fees and partial fills, trading-only API credentials held on a secure server, an account kill switch, emergency alerts, maximum real account budget and explicit approval. No live broker integration currently exists. Broker-cash proceeds after a sale are different from **bank withdrawals**, which require a separate authorised process.

The existing Netlify production site was a manual upload. GitHub code changes do not update its pages until the existing site is connected for continuous deployment or manually redeployed.
