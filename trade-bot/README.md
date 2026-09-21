# Trade Desk Auto — V1 Live Micro

This is the real-money execution layer for Mr G's Trade Desk.

## Direction

The project is no longer designed as a paper-only destination. The production target is **small real-money automated trading through Interactive Brokers (IBKR)** with hard safety limits.

Paper mode remains available as a diagnostic tool, but the live path is already in the code.

## Why IBKR

- South African residents can open IBKR accounts.
- IBKR provides official APIs for programmatic trading.
- The Web API supports order previews and live order submission.
- The system can use cash-quantity orders, which suits small dollar-sized trades.

## Live Micro defaults

Before any larger capital is used, V1 is deliberately capped:

- USD 5 default BUY
- USD 10 hard maximum BUY
- maximum 2 live orders per UTC day
- only tickers on the allow-list may trade
- the same signal ID cannot execute twice
- every order is previewed through IBKR What-If before submission
- IBKR warning/reply messages are never auto-confirmed
- SELL will not liquidate a position unless the signal contains an explicit quantity
- no margin, options, shorting or leverage logic is included

These controls are designed to limit damage while the live system is being proven. They do not guarantee profit.

## Signal feed

The bot reads:

`https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/main/trade-desk/signal.json`

A live BUY may contain:

- `id`
- `ticker`
- `action: "BUY"`
- optional `cash_usd`
- optional `conid` (the bot can resolve it through IBKR)

A live SELL must additionally contain:

- `quantity`

## Live setup

1. Open and fund an IBKR account.
2. Install and sign in to IBKR Client Portal Gateway.
3. Copy `.env.example` to `.env`.
4. Add the IBKR account ID.
5. Set `TRADING_MODE=live`.
6. Keep `ENABLE_LIVE_ORDERS=NO` for the first authenticated What-If preview.
7. After the preview is confirmed, set:
   `ENABLE_LIVE_ORDERS=YES_I_ACCEPT_LIVE_RISK`
8. Run `python bot.py`.

IBKR's retail Client Portal Gateway requires user authentication. The bot cannot and should not bypass that security step.

## Next engineering step

After the first successful small live BUY, add automatic exit management using the confirmed fill quantity plus a protective stop / take-profit order. That is the next milestone before increasing the live order cap.
