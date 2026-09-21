# Trade Desk Auto — V1

This is the automated execution layer for Mr G's Trade Desk.

## Current stage

V1 is PAPER-TRADING ONLY by default. It consumes the existing Trade Desk signal feed and applies hard risk rules before recording a simulated trade.

The live broker target is Interactive Brokers (IBKR) because:
- South Africa is an available account country.
- IBKR provides official trading APIs.
- The API can place and monitor orders programmatically.

## Safety gates

The bot will not trade when:
- the signal is HOLD
- required price data is missing
- the allocation is above the configured max per trade
- daily loss lock is active
- the ticker is not allow-listed (when an allow-list is configured)
- LIVE trading is not explicitly enabled

Default controls:
- 5% max account allocation per new trade
- 20% max exposure to one symbol
- 2% daily loss lock
- paper mode

These are protective defaults, not investment advice. They can be changed after testing.

## Run

1. Copy `.env.example` to `.env`.
2. Install: `pip install -r requirements.txt`
3. Run: `python bot.py`

The bot reads the current signal from:
`https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/main/trade-desk/signal.json`

For a paper BUY/SELL to execute, the signal should contain:
- ticker
- action
- reference_price
- allocation_pct for BUY
- optional stop_loss
- optional take_profit
- optional conid (required for future IBKR live mode)

## Live trading

Do not enable live mode until:
1. an IBKR account is open;
2. paper trading has been validated;
3. API authentication works;
4. order preview / what-if checks pass;
5. daily-loss and position-size limits are confirmed.

The IBKR adapter is included as a guarded scaffold. Live order submission requires `TRADING_MODE=live` and `ENABLE_LIVE_ORDERS=YES_I_ACCEPT_LIVE_RISK`.
