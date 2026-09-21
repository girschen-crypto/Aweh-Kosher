import os
import sys
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

from paper_broker import PaperBroker

load_dotenv()

SIGNAL_URL = os.getenv(
    "SIGNAL_URL",
    "https://raw.githubusercontent.com/girschen-crypto/Aweh-Kosher/main/trade-desk/signal.json",
)
MODE = os.getenv("TRADING_MODE", "paper").lower()
MAX_TRADE_PCT = float(os.getenv("MAX_TRADE_PCT", "5"))
MAX_SYMBOL_EXPOSURE_PCT = float(os.getenv("MAX_SYMBOL_EXPOSURE_PCT", "20"))
MAX_DAILY_LOSS_PCT = float(os.getenv("MAX_DAILY_LOSS_PCT", "2"))
ALLOWED = {x.strip().upper() for x in os.getenv("ALLOWED_TICKERS", "").split(",") if x.strip()}


def get_signal():
    r = requests.get(SIGNAL_URL, timeout=15, headers={"Cache-Control": "no-cache"})
    r.raise_for_status()
    return r.json()


def validate_signal(s):
    ticker = str(s.get("ticker", "")).upper().strip()
    action = str(s.get("action", "HOLD")).upper().strip()
    if not ticker:
        raise ValueError("Signal has no ticker.")
    if action not in {"BUY", "SELL", "HOLD"}:
        raise ValueError(f"Unsupported action: {action}")
    if ALLOWED and ticker not in ALLOWED:
        raise ValueError(f"{ticker} is not on the allow-list.")
    return ticker, action


def paper_run(signal):
    broker = PaperBroker(
        os.getenv("PAPER_LEDGER", "paper_ledger.json"),
        float(os.getenv("PAPER_STARTING_CASH", "10000")),
        os.getenv("PAPER_CURRENCY", "USD"),
    )

    ticker, action = validate_signal(signal)
    if action == "HOLD":
        return {"status": "NO_TRADE", "reason": "HOLD signal", "ticker": ticker}

    price = signal.get("reference_price")
    if price is None:
        return {
            "status": "BLOCKED",
            "reason": "Signal is missing reference_price. Bot will not trade without a price.",
            "ticker": ticker,
        }
    price = float(price)
    if price <= 0:
        return {"status": "BLOCKED", "reason": "Invalid reference_price.", "ticker": ticker}

    equity = broker.equity({ticker: price})
    day = datetime.now(timezone.utc).date().isoformat()
    daily_pnl = float(broker.state.get("daily_realized_pnl", {}).get(day, 0.0))
    if daily_pnl <= -(equity * MAX_DAILY_LOSS_PCT / 100.0):
        return {"status": "LOCKED", "reason": "Daily loss limit reached.", "ticker": ticker}

    if action == "BUY":
        requested_pct = float(signal.get("allocation_pct") or MAX_TRADE_PCT)
        trade_pct = min(requested_pct, MAX_TRADE_PCT)
        existing = broker.symbol_exposure(ticker, price)
        max_symbol_value = equity * MAX_SYMBOL_EXPOSURE_PCT / 100.0
        room = max(0.0, max_symbol_value - existing)
        notional = min(equity * trade_pct / 100.0, room, float(broker.state["cash"]))
        if notional <= 0:
            return {"status": "BLOCKED", "reason": "No risk capacity or cash available.", "ticker": ticker}
        trade = broker.buy(
            ticker,
            notional,
            price,
            {
                "signal_id": signal.get("id"),
                "stop_loss": signal.get("stop_loss"),
                "take_profit": signal.get("take_profit"),
                "reason": signal.get("reason"),
            },
        )
        return {"status": "PAPER_FILLED", "trade": trade}

    if action == "SELL":
        try:
            trade = broker.sell(
                ticker,
                price,
                meta={"signal_id": signal.get("id"), "reason": signal.get("reason")},
            )
            return {"status": "PAPER_FILLED", "trade": trade}
        except ValueError as e:
            return {"status": "BLOCKED", "reason": str(e), "ticker": ticker}

    return {"status": "NO_TRADE", "ticker": ticker}


def live_run(signal):
    from ibkr_broker import IBKRBroker

    ticker, action = validate_signal(signal)
    if action == "HOLD":
        return {"status": "NO_TRADE", "reason": "HOLD signal", "ticker": ticker}

    conid = signal.get("conid")
    quantity = signal.get("quantity")
    if not conid or not quantity:
        return {
            "status": "BLOCKED",
            "reason": "Live IBKR mode requires signal fields conid and quantity.",
            "ticker": ticker,
        }

    broker = IBKRBroker()

    # V1 always performs a what-if check first.
    preview = broker.what_if(int(conid), action, float(quantity))
    if os.getenv("ENABLE_LIVE_ORDERS", "NO") != "YES_I_ACCEPT_LIVE_RISK":
        return {"status": "PREVIEW_ONLY", "preview": preview}

    result = broker.place_order(int(conid), action, float(quantity))
    return {"status": "LIVE_ORDER_SENT", "preview": preview, "result": result}


def main():
    signal = get_signal()
    result = paper_run(signal) if MODE != "live" else live_run(signal)
    print(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print({"status": "ERROR", "error": str(exc)}, file=sys.stderr)
        raise
