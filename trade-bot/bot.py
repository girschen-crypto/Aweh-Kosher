import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

import requests
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

LIVE_DEFAULT_ORDER_USD = float(os.getenv("LIVE_DEFAULT_ORDER_USD", "5"))
LIVE_MAX_ORDER_USD = float(os.getenv("LIVE_MAX_ORDER_USD", "10"))
LIVE_MAX_ORDERS_PER_DAY = int(os.getenv("LIVE_MAX_ORDERS_PER_DAY", "2"))
LIVE_STATE_FILE = Path(os.getenv("LIVE_STATE_FILE", "live_state.json"))


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
        raise ValueError(f"{ticker} is not on the live allow-list.")
    return ticker, action


def _load_live_state():
    if LIVE_STATE_FILE.exists():
        try:
            return json.loads(LIVE_STATE_FILE.read_text())
        except Exception:
            pass
    return {"executed_signal_ids": [], "orders_by_day": {}}


def _save_live_state(state):
    LIVE_STATE_FILE.write_text(json.dumps(state, indent=2))


def _today():
    return datetime.now(timezone.utc).date().isoformat()


def _live_order_count(state):
    return int(state.get("orders_by_day", {}).get(_today(), 0))


def _record_live_signal(state, signal_id):
    if signal_id:
        ids = state.setdefault("executed_signal_ids", [])
        if signal_id not in ids:
            ids.append(signal_id)
        if len(ids) > 500:
            del ids[:-500]
    by_day = state.setdefault("orders_by_day", {})
    by_day[_today()] = int(by_day.get(_today(), 0)) + 1
    _save_live_state(state)


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
    signal_id = str(signal.get("id") or "").strip()
    if action == "HOLD":
        return {"status": "NO_TRADE", "reason": "HOLD signal", "ticker": ticker}

    state = _load_live_state()
    if signal_id and signal_id in state.get("executed_signal_ids", []):
        return {"status": "NO_TRADE", "reason": "Signal already executed.", "ticker": ticker}
    if _live_order_count(state) >= LIVE_MAX_ORDERS_PER_DAY:
        return {"status": "LOCKED", "reason": "Live daily order-count limit reached.", "ticker": ticker}

    broker = IBKRBroker()
    auth = broker.auth_status()
    if not auth.get("authenticated"):
        return {"status": "BLOCKED", "reason": "IBKR brokerage session is not authenticated."}

    conid = int(signal.get("conid") or broker.resolve_conid(ticker))
    coid = ("mrg-" + (signal_id or f"{ticker}-{_today()}")).replace(":", "-").replace("+", "-")

    if action == "BUY":
        requested = float(signal.get("cash_usd") or LIVE_DEFAULT_ORDER_USD)
        cash_usd = min(max(requested, 1.0), LIVE_MAX_ORDER_USD)
        preview = broker.what_if_cash(conid, "BUY", cash_usd)

        if os.getenv("ENABLE_LIVE_ORDERS", "NO") != "YES_I_ACCEPT_LIVE_RISK":
            return {
                "status": "READY_FOR_LIVE",
                "ticker": ticker,
                "cash_usd": cash_usd,
                "preview": preview,
            }

        result = broker.place_cash_order(conid, "BUY", cash_usd, coid)
        _record_live_signal(state, signal_id)
        return {
            "status": "LIVE_ORDER_SENT",
            "ticker": ticker,
            "cash_usd": cash_usd,
            "preview": preview,
            "result": result,
        }

    if action == "SELL":
        # V1 deliberately refuses to liquidate an existing holding unless the
        # signal includes an explicit quantity. This prevents a SELL signal
        # from accidentally closing shares that were not bought by the bot.
        quantity = signal.get("quantity")
        if quantity is None:
            return {
                "status": "BLOCKED",
                "reason": "Live SELL requires an explicit quantity in the signal.",
                "ticker": ticker,
            }
        quantity = float(quantity)
        if quantity <= 0:
            return {"status": "BLOCKED", "reason": "Invalid SELL quantity.", "ticker": ticker}

        position = broker.position_for_conid(conid)
        held = float(position.get("position", 0)) if position else 0.0
        if held <= 0:
            return {"status": "BLOCKED", "reason": "No IBKR position found to sell.", "ticker": ticker}
        quantity = min(quantity, held)

        preview = broker.what_if_quantity(conid, "SELL", quantity)
        if os.getenv("ENABLE_LIVE_ORDERS", "NO") != "YES_I_ACCEPT_LIVE_RISK":
            return {
                "status": "READY_FOR_LIVE",
                "ticker": ticker,
                "quantity": quantity,
                "preview": preview,
            }

        result = broker.place_quantity_order(conid, "SELL", quantity, coid)
        _record_live_signal(state, signal_id)
        return {
            "status": "LIVE_ORDER_SENT",
            "ticker": ticker,
            "quantity": quantity,
            "preview": preview,
            "result": result,
        }

    return {"status": "NO_TRADE", "ticker": ticker}


def main():
    signal = get_signal()
    result = live_run(signal) if MODE == "live" else paper_run(signal)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"status": "ERROR", "error": str(exc)}), file=sys.stderr)
        raise
