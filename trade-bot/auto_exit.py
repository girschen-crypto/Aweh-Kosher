import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

from ibkr_broker import IBKRBroker
from bot import _load_live_state, _live_order_count, _record_live_signal

load_dotenv()

TAKE_PROFIT_PCT = float(os.getenv("AUTO_EXIT_TAKE_PROFIT_PCT", "8"))
STOP_LOSS_PCT = float(os.getenv("AUTO_EXIT_STOP_LOSS_PCT", "5"))
AUTO_EXIT_ENABLED = os.getenv("AUTO_EXIT_ENABLED", "NO").upper() == "YES"
LIVE_MAX_ORDERS_PER_DAY = int(os.getenv("LIVE_MAX_ORDERS_PER_DAY", "2"))


def _num(row, *keys):
    for key in keys:
        value = row.get(key)
        try:
            n = float(value)
            if n > 0:
                return n
        except (TypeError, ValueError):
            pass
    return None


def evaluate_position(row):
    qty = abs(float(row.get("position") or 0))
    if qty <= 0:
        return None

    avg = _num(row, "avgPrice", "avgCost")
    current = _num(row, "mktPrice", "marketPrice")
    if current is None:
        value = _num(row, "mktValue", "marketValue")
        if value is not None and qty > 0:
            current = value / qty

    if avg is None or current is None:
        return None

    change_pct = (current / avg - 1.0) * 100.0
    if change_pct >= TAKE_PROFIT_PCT:
        return {
            "trigger": "TAKE_PROFIT",
            "change_pct": change_pct,
            "qty": qty,
            "avg": avg,
            "current": current,
        }
    if change_pct <= -STOP_LOSS_PCT:
        return {
            "trigger": "STOP_LOSS",
            "change_pct": change_pct,
            "qty": qty,
            "avg": avg,
            "current": current,
        }
    return {
        "trigger": "HOLD",
        "change_pct": change_pct,
        "qty": qty,
        "avg": avg,
        "current": current,
    }


def run():
    broker = IBKRBroker()
    auth = broker.auth_status()
    if not auth.get("authenticated"):
        return {"status": "BLOCKED", "reason": "IBKR session is not authenticated."}

    state = _load_live_state()
    if _live_order_count(state) >= LIVE_MAX_ORDERS_PER_DAY:
        return {"status": "LOCKED", "reason": "Daily live-order limit reached."}

    checks = []
    for row in broker.positions():
        decision = evaluate_position(row)
        if not decision:
            continue

        ticker = str(row.get("ticker") or row.get("symbol") or "").upper().strip()
        conid = row.get("conid")
        if not ticker or not conid:
            checks.append({"status": "SKIPPED", "reason": "Ticker/conid missing", "row": row})
            continue

        decision["ticker"] = ticker
        decision["conid"] = int(conid)
        checks.append(decision)

        if decision["trigger"] == "HOLD":
            continue

        preview = broker.what_if_quantity(int(conid), "SELL", decision["qty"])
        if not AUTO_EXIT_ENABLED:
            return {
                "status": "READY_FOR_AUTO_EXIT",
                "decision": decision,
                "preview": preview,
                "checks": checks,
            }

        coid = (
            f"mrg-auto-{ticker}-{decision['trigger']}-"
            + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        )
        result = broker.place_quantity_order(
            int(conid),
            "SELL",
            decision["qty"],
            coid,
        )
        _record_live_signal(
            state,
            f"auto-exit-{ticker}-{decision['trigger']}-{datetime.now(timezone.utc).date().isoformat()}",
        )
        return {
            "status": "AUTO_EXIT_SENT",
            "decision": decision,
            "preview": preview,
            "result": result,
            "checks": checks,
        }

    return {"status": "NO_EXIT", "checks": checks}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, default=str))
