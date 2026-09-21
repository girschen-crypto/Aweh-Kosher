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
