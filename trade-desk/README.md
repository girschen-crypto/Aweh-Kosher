# Mr G TradeDesk — Signals Only

## Current release: autonomous execution preparation, live locked (5 November 2026)

This section supersedes earlier signals-only product restrictions below. The owner requested autonomous native VALR futures execution with an R200 initial budget, R2 planned loss per trade including costs, 2× maximum leverage, one open position, R6 daily realised loss suspension, R20 account drawdown suspension and three consecutive losses before suspension. The existing additional R40 margin cap is retained. No real order, deposit, conversion, transfer, withdrawal or live enablement was performed.

Implemented server modules:

- `tradedesk-trading-policy.mjs`: exact decimal quantity/tick rounding, cost-aware risk sizing, current FX, exchange minimums, spread/depth checks, deterministic IDs and fixed loss limits. Initial additional engineering defaults: gross 3R target, minimum modelled net reward/risk 1.2, 15bp maximum spread, 5bp slippage per side, two-hour holding limit.
- `tradedesk-valr-execution.mjs`: HMAC-SHA512 signing with separate trade credentials, strict endpoint allowlist, native USDT futures only, FOK limit entries with attached `conditionalOrderData`, history confirmation, partial fills, regular-order cancellation and reduce-only emergency closure. Mutating requests are never blindly retried, including lost response bodies.
- `tradedesk-trading-engine.mjs`: durable reservation before entry, fill/position reconciliation, independent active OCO verification, protection-failure reduction, partial-exit accounting, private fees/funding checks, ledger/wallet reconciliation, emergency stop, deployment/restart uncertainty and controlled-test suspension. Unattended mode additionally requires a recorded closed controlled test with verified protection.
- `tradedesk-journal.mjs` and `db/001_trading.sql`: PostgreSQL session advisory lock, unique active-position and signal constraints, compare-and-set transitions, append-only audit events and derived performance. The migration is deliberately outside Netlify's automatic DB directory. Installing the `pg` driver does not provision a database. Netlify Blobs remains public observation storage, not a transaction journal.
- `tradedesk-release.mjs`: current report/policy identity, positive holdout sample and forward-evidence checks. Current evidence fails. Even correct credentials, an environment flag and an approval record cannot bypass this failed release check. Initial evidence defaults are at least seven forward-test days, 20 closed forward trades, 20 holdout trades, positive holdout net return and profit factor at least 1.1. These thresholds do not establish guaranteed future returns.
- `tradedesk-trading.mjs`: public non-sensitive mode/limits, authenticated read-only account diagnostics, private journal and Stop New Trading. It provides no HTTP live-activation operation. Private data remains production-origin and owner-session restricted.
- The existing 15-minute collector now validates EMA50 trend/EMA21 slope in addition to EMA9/21, RSI14 and ATR14, and archives immutable public observations. It does not itself place orders. Only a configured transactional journal triggers the separate background paper/execution worker; that worker independently checks production origin, owner authentication and all live gates.

### Verified research and exact operating status

- 76 automated Node tests plus the existing simulator checks pass. PostgreSQL-compatible integration tests exercise uniqueness, state transitions, loss calculations and the persistent stop. Lifecycle tests use realistic simulated exchange responses, not real trades.
- Four native futures, FX order books, pair minimums, precision, 2× leverage tiers and order types were retrieved from VALR's public API. The new private account, fee, order, fill and conditional paths have **not** been exercised against the owner's actual account.
- Research downloaded 1,344 actual 15-minute candles per futures pair and 1,344 USDTZAR candles for 22 October–5 November 2026, with actual public funding history. The first nine days form the earlier period; the final five days are the holdout. Parameters were fixed before the model run. The simulator uses prior closed candles, avoids overlapping same-bar entries and prioritises stops if both stop/target touch a candle.
- Risk-limited holdout: **three trades, three losses, net −R1.0224**, then consecutive-loss suspension. Diagnostic without suspensions: **39 trades, net −R12.3403**. Estimated tier-1 taker fees, historical spread/slippage assumptions, current minimums and mark-price execution modelling limit these results. Intrabar mark-to-market drawdown is not established by the closed-equity drawdown figures. No profitability claim is supported.
- Public minimum assessment at the recorded FX/price snapshot: ETH ~R19.93, SOL ~R15.95, XRP ~R21.74 in minimum 2× margin, before other checks; BTC ~R66.23 exceeds the retained R40 cap. These are indicative changing market amounts, not guaranteed affordable trades.
- Real-money readiness: **NO**. Exchange-side protection on a real position: **NOT CONFIRMED**. Completed forward-paper evidence: **0 days**. Mode: **PAPER, locked**.
- `app/validation-report.html` and `app/trading-validation.json` publish the full dated methodology and simulated trade journal. `scripts/collect-history.mjs` and `scripts/backtest.mjs` reproduce the research. Rate limits are respected; historical batches are cached locally and retried with backoff.

### Connected forward paper journal

The existing Supabase project `vyvinzpsfhvxdzxfuwiw` contains private schema `tradedesk`. The committed Supabase migration creates paper-only trades, events, a fenced worker lease and immutable forward observations. Tables enable RLS and revoke anonymous/authenticated access. No policy is intentionally defined: ordinary roles have no access. The new `tradedesk-journal` Edge Function uses its built-in database credential, accepts a separate 256-bit server token whose SHA-256 alone is stored in the database, rejects Origin headers and exposes a fixed operation allowlist. It has no broker keys and cannot store LIVE rows or activate trading.

Netlify's `TRADEDESK_JOURNAL_URL` and secret `TRADEDESK_JOURNAL_TOKEN` connect production functions to that service. The current Netlify plan permits the combined Builds/Functions/Runtime scopes; Production is the only nonempty context. Do not put the token in source, frontend variables or request logs. Source builds never interpolate environment values into assets. No Supabase service-role key or DB URL is exported to Netlify.

The 15-minute production signal collector invokes the background worker. An initial/recovery paper-only invocation may use the server journal token in `x-tradedesk-paper-token`; this path requires the remote adapter, which rejects LIVE intents even when other configuration exists. The token never enables the live PostgreSQL worker. SQL uniqueness and compare-and-set transitions remain authoritative. A five-minute database lease serialises paper cycles; its epoch prevents an expired worker from updating state or releasing a successor's lock. The lease is deliberately for PAPER only. Live execution retains the original session advisory lock and requires separate setup/review. Paper journal configuration takes precedence if both configurations exist, preventing accidental migration to live storage.

Successful cycles record actual scan/deployment/policy/proof/result timestamps; observations older than 20 minutes or in the future are rejected. Dashboard start/latest/count are queried from these rows, not invented elapsed evidence. Paper simulations sample order books every 15 minutes, so intraperiod stop/target excursions may be missed. Neither paper results nor test fixtures verify actual exchange stops. Daily read-only account diagnostics use existing server credentials and store only readiness flags/error, never balances or identifiers. Private journal access remains owner/passkey restricted.

Production smoke checks: public status must show PAPER, `journalHealthy:true`, and advancing `forward.last_observed_at`; no token must return 401 at the journal Edge Function; overlapping acquisitions must return no lease; Netlify preview private endpoints must return 403; unauthenticated stop/journal/activation must return 401. Use the owner/passkey for private journal/Stop New Trading. Never insert test trades into production or reset a risk suspension to improve the results.

### Required external setup after strategy evidence improves

The existing Supabase TradeDesk project now hosts the PAPER journal. No new project, subscription or trading credential was created. Live activation requires an approved existing PostgreSQL database because the current file storage cannot provide transactional order state. Apply `trade-desk/db/001_trading.sql` through that database provider's supported migration workflow, then store its TLS URL as secret `TRADEDESK_DATABASE_URL` in the existing Netlify project's **Environment variables**, **Functions** scope, **Production** context only. Do not use a preview database or public client key for the real journal.

Only when the evidence and account checks pass: on VALR's existing TradeDesk subaccount, create a separate API key with **View access and Trade only**. Preserve the old read-only key. Set secret production Functions variables `TRADEDESK_VALR_TRADE_API_KEY` and `TRADEDESK_VALR_TRADE_API_SECRET`. No Transfer, Withdraw or Link Bank Account permissions are accepted by the verifier. Funding, converting ZAR to USDT and enabling futures/terms are separate owner actions, not performed by this release.

`TRADEDESK_LIVE_AUTHORIZED` and the database approval record remain unset. A future explicit approval must specify capital R200, this policy hash, verified subaccount, current deployment ID and commit, expiry, evidence identity and `CONTROLLED_TEST` phase. The controller stops after one fully reconciled controlled lifecycle. Unattended activation requires a second review with that successful controlled-test record; it is never inferred from a successful API response.

Implementation references: VALR API documentation at https://docs.valr.com/ and VALR's official developer reference repository https://github.com/valrdotcom/valr-agent-skills, revision `a96dd36892e8784d18d7ee789bfe218806c565f3`, particularly `references/trading.md`, `conditionals.md`, `futures.md`, `fees.md`, `account.md` and `market-data.md`. Native futures are distinct from the main-account-only USDC Simple Perps product. Actual private behaviour remains a required activation check.

**Product decision (3 November 2026):** TradeDesk focuses exclusively on futures-style trading signals. The old multi-market investment dashboard, stock watchlists, equity broker selectors, public-market radar, and unattended spot paper-cycle are no longer part of the visible application.

## Automatic signals and a separate manual simulator

The current application collects its own read-only VALR futures signals every 15 minutes. Viewing and refreshing collected signals is public. Manual scans and private balances require an owner password or valid passkey session. See the autonomous signal collection section below. This newer workflow supersedes the earlier pasted-signals-only restriction.

The separate USDT practice simulator works as follows:

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

- Main app homepage: `trade-desk/app/index.html`, using `futures-lab.js`, `tradedesk-signals.js` and `tradedesk-valr-client.js`.
- Legacy `futures-lab.html` redirects to the same new homepage.
- Offline cache: `trade-desk/app/sw.js`, caches only signal-related files.
- Automatic signals use public VALR futures data; manual examples use **user-pasted text**.
- Data: browser-local storage under `mrgTradeDeskFuturesLabV1`; it does **not** sync to an account or broker.
- No real order placement, deposits, cash withdrawals or exchange-native stops. Private credentials stay on the server for the optional read-only balance connection.
- No unrelated equity or spot-crypto investment screens remain in the homepage.
- Legacy scanning/spot engine source files remain in Git history and/or unused source paths for reversibility, but the two GitHub Actions scheduled workflows `tradedesk-radar.yml` and `tradedesk-auto-cycle.yml` were removed from the branch.
- The earlier share and spot-investment features remain retired. The newer VALR futures collector is described below.

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
- The passkey provides access to read-only VALR balances and on-demand public futures scans. It is **not** proof of authorisation for live-trading orders and does not enable Trade, Internal Transfer or Withdraw permissions.
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

## Production verification repairs (5 November 2026)

- Stored scans expire after 20 minutes. The API suppresses stale LONG/SHORT directions; the browser also expires displayed signals locally and clears them on network failure or offline events. Historical events remain clearly historical.
- Every candle used by the indicators must have valid OHLC values, a 15-minute boundary and consecutive timestamps. Conflicting duplicate candles fail closed.
- Preview origins cannot access the private balance reader even if a password is supplied. Private API responses stay outside the service-worker cache.
- The page distinguishes the illustrative R200 signal budget from the fictional 200 USDT manual simulator. Dates display in SAST. No passkey or password is needed for collected signals.
- A virtual authenticator integration test exercises the actual WebAuthn verification library from registration through signed authentication, an eight-hour cookie, read-only balance access, challenge replay rejection and logout. Physical device biometric approval and the owner's actual VALR balance still require the owner's registered device.
- `npm ci && npm test` runs the automated checks. Dependencies are pinned in `package-lock.json`.
- `netlify.tradedesk.toml` isolates TradeDesk's build configuration from other applications in this repository. For CLI publication to the existing project, use `npx netlify-cli deploy --config netlify.tradedesk.toml --build --prod --site 8f30bbc0-5a3d-4f24-ba52-0cd31498d03c` after authenticating to Netlify. If continuous Git deployment is connected, subsequent production-branch builds replace manual publications; use the same committed source and configuration.
