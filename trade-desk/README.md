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

## Fingerprint / face-unlock (passkeys) for read-only VALR balances

The balance reader supports an optional **WebAuthn passkey**. Supported phones and computers use their device fingerprint, face unlock or device PIN to approve an authentication signature. TradeDesk does **not** see or store any face/fingerprint data.

- First enrolment requires the **TradeDesk owner password** as a one-time proof of ownership. **Rotate the owner token privately in Netlify before enrolling**, as the old token was previously shared in a chat. Publish the environment change before enrolment. Never use a VALR API key or secret as the owner password.
- On your phone: open the **production** site at `https://mrg-trade-desk.netlify.app` in Chrome or another passkey-compatible browser, enter the **separate TradeDesk owner password** once and tap **Enable biometrics on this device**. Confirm the device passkey prompt.
- After enrolment: tap **Use fingerprint / face unlock** when the signed-in session expires. Signed-in sessions last up to eight hours; during the session, **Read VALR balance** does not require a password. A manual **Sign out** ends that browser session.
- A passkey is tied cryptographically to `mrg-trade-desk.netlify.app`, cannot be replayed on another domain, and verifies the owner with device user verification **required**.
- Persistent passkey *public* credential and time-limited one-time challenge state are stored server-side in Netlify Blobs, with strong consistency and conditional writes for replay prevention. Do not use the shared, public web page as a passkey database.
- The valid session is an 8-hour, signed `__Host-` cookie with `HttpOnly`, `Secure` and `SameSite=Strict`; the browser stores no password or biometric. Rotating `TRADEDESK_OWNER_TOKEN` invalidates current sessions and permits password recovery. The existing password remains a fallback.
- The passkey provides access to **only one read-only VALR balance endpoint**. It is **not** proof of authorisation for future live-trading orders and does not enable Trade, Internal Transfer or Withdraw permissions.
- The passkey endpoints refuse Netlify Deploy Preview origins; only the production RP ID/origin is accepted. Preview deployments must never have live key access.
- Test: `npm install --no-audit --no-fund && node --test trade-desk/tests/passkey-auth.test.mjs`; deployment also runs the existing VALR and futures paper tests. Verify registration, fingerprint sign-in, balance read, sign out and recovery on a real device before considering the feature fully validated.

There are no additional subscriptions required. If the production passkey function is unavailable, the old **owner-password balance reader** stays available.

**Lost-phone or compromised-passkey recovery:** Use **Remove saved passkeys** on the production dashboard. It requires the current separate TradeDesk owner password and revokes all registered passkeys, after which you can register a new device. If a phone was actually lost or compromised, **also rotate `TRADEDESK_OWNER_TOKEN` directly in Netlify** to invalidate any previously issued signed sessions (cookies can otherwise remain usable until their eight-hour expiry). Redeploy after changing that secret. Neither action requires changes to your VALR API key. Never share owner token or VALR API credentials in chat.

## Autonomous VALR futures signal collection — R200 test budget (5 November 2026)

This extension keeps TradeDesk **signals only** and adds its own market-data signal generator, separate from the previous pasted WhatsApp signal parser.

- Read-only data: VALR's public `/v1/public/futures/info` and `/v1/public/{pair}/markprice/buckets?periodSeconds=900` routes. No API key or secret used for market scanning.
- Markets: BTCUSDTPERP, ETHUSDTPERP, SOLUSDTPERP, XRPUSDTPERP, **only** when futures/info confirms they are listed. The signal engine refuses to substitute spot candlesticks or make up unavailable data.
- Analysis: confirmed closed 15-minute mark-price candles, EMA 9/21 crossover, RSI(14) filter, ATR(14) volatility and stale-data guards. Output = LONG, SHORT or WAIT, where WAIT is normal and desirable when evidence is insufficient.
- Scheduling: Netlify's existing Scheduled Functions feature, one scan every 15 minutes UTC, using `netlify/functions/tradedesk-signal-cycle.mjs`, with a maximum four markets. Scheduled scans begin on the published production deploy; no new server or subscription. Netlify Blobs holds the last scan and deduplicated event journal.
- Dashboard: `trade-desk/app/tradedesk-signals.js` displays signals from the stored public data without requiring login. An on-demand *Scan now* is restricted to a valid TradeDesk owner passkey session or owner password; a 3-minute cooldown limits repeated upstream API calls.
- **Budget reference R200**, max planned risk R2 per trade, **maximum hypothetical leverage 2×**, and R40 maximum indicative margin per signal. Position sizing is an **illustrative ZAR ceiling only** and NOT a real exchange order: a ZAR/USDT FX quote, actual contract quantity/precision, minimum order size, spread, taker fees, funding and slippage remain unverified.
- All results have `executable:false` by design. There is **no live VALR Trade permission, real execution, API order submission, auto-deposit, auto-funding or asset transfer**.
- Existing read-only VALR sub-account balance and passkey access remain separate and untouched. The signal engine does not consume the owner's capital or trade the user's R200.
- **Signal collection is not yet an evaluated trading strategy.** We must verify a representative run of actual market data, generate a paper-trade journal, backtest out-of-sample, and check fee-adjusted results and drawdowns before considering any live pilot. Absence of a qualifying signal should never force an entry.
- Verify with `node --test trade-desk/tests/signal-engine.test.mjs` and the existing security CI. Real live signal feed validation is a separate post-deploy requirement; synthetic tests cannot prove a profitable strategy.

Netlify scheduled functions are supported on all Netlify plans, and the public VALR futures market and mark-price routes are documented by VALR. Be mindful of usage limits and do not add paid infrastructure for R200 test capital.
