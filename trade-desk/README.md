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


## VALR read-only balance connection (4 November 2026)

The signal-only dashboard now includes a **read-only VALR sub-account balance panel**, not a deposit wallet or live trading engine.

### Security model

- Source code: `netlify/functions/tradedesk-valr-balances.mjs` (secure backend) and `trade-desk/app/tradedesk-valr-client.js` (browser display).
- Backend permits **POST to this one balance-reader route only**; VALR call is hard-coded to **GET /v1/account/balances**. No live trade, transfer or withdraw requests.
- Server credentials are never committed to GitHub, never returned to browser, and must never be pasted into the public TradeDesk dashboard.
- A separate owner password of **at least 32 random characters** is required to see balances; its comparison is timing-safe. The password is cleared from the page after each request and is not stored in localStorage/cookies.
- Requests from other web origins are rejected, and balance responses have `Cache-Control: private, no-store`.
- VALR access is scoped to the **TradeDesk sub-account API key** created in VALR with **View access only**. If the user mistakenly made a primary-account key, replace it with a sub-account key rather than enabling wider impersonation.
- If any required environment variable is missing, the endpoint fails closed with `NOT_CONFIGURED`; it never retrieves or publishes a balance.
- This is personal-use security for a private balance function on a publicly accessible site; for later paid/multi-user use, introduce a full identity and authorisation service with rate limiting and session management.

### One-time owner setup in existing Netlify project

Open Netlify → **mrg-trade-desk** → **Project configuration → Environment variables**. Create these three values as **secret** variables, scoped to **Functions** and production (or all scopes if function scope isn't available):

1. `TRADEDESK_VALR_API_KEY` — paste the key from the VALR **TradeDesk sub-account**. Do not reveal it to anyone or put it in GitHub.
2. `TRADEDESK_VALR_API_SECRET` — paste the matching secret from VALR. The API secret may not be recoverable after closing the VALR creation screen; if not saved, revoke the key and create a fresh **View access only** key.
3. `TRADEDESK_OWNER_TOKEN` — a **new separate**, random 32+ character password generated in a password manager. Never use the VALR password, VALR API secret, or any repeated password.

After saving all three, trigger a fresh production deploy so the Netlify Function receives the variables. Open `https://mrg-trade-desk.netlify.app`, enter only the separate TradeDesk owner password into its read-only VALR panel and click **Read VALR balance**.

**Never send any of these credentials or a screenshot exposing them in chat.** No IP whitelist is configured because regular Netlify Functions do not provide a fixed outgoing IP without additional networking services; a wrong IP whitelist can block API calls. A future hardened setup should address this before trade-enabled keys.

### Functional limitations

The signal simulator remains local and completely separate from VALR balances. It does **not** use a live VALR balance to size or place real orders. Never imply that the virtual 200 USDT is a real VALR balance. No real funds can be deposited *into TradeDesk*; any funding occurs directly on the user's own VALR sub-account. Real-money automated futures execution is **not available or authorised** at this stage.

Use `node --test trade-desk/tests/valr-balances.test.mjs` for backend permission, auth and signature tests.

### Applying rotated VALR credentials (4 November 2026)

TradeDesk reads its VALR credentials from secret Netlify environment variables at deployment time. When the owner corrects the read-only VALR API secret in the existing Netlify project, publish a new production deployment before checking the connection. Never paste or commit any actual API credential into GitHub or the public TradeDesk interface. Live trading remains disabled.
