#!/usr/bin/env python3
"""TradeDesk profit cycle. Paper-only public-market automation, never broker execution.

The scanner proposes research candidates. This independent risk gate uses fresh
Binance Spot public quotes to simulate entries and exits every scheduled run.
Real funds are NEVER moved. Do not add withdrawal or order endpoints here.
"""
import argparse
import json
import math
import os
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = ROOT / "auto-cycle-state.json"
DEFAULT_RADAR = ROOT / "market-radar.json"
MARKET_API = "https://data-api.binance.vision/api/v3"
CONFIG = {
    "initial_paper_cash_usdt": 25.00,
    "max_position_usdt": 5.00,
    "max_allocation_fraction": 0.20,
    "max_single_trade_risk_fraction": 0.01,
    "max_daily_loss_fraction": 0.02,
    "max_daily_entries": 2,
    "max_positions": 1,
    "stop_loss_fraction": 0.02,
    "take_profit_fraction": 0.035,
    "simulated_fee_fraction_each_side": 0.001,
    "simulated_slippage_fraction_each_side": 0.001,
    "max_hold_hours": 24,
    "min_radar_score": 80,
    "max_radar_age_minutes": 90,
    "max_price_change_from_scan_fraction": 0.005,
    "same_coin_cooldown_hours": 24
}
# The 25-USDT balance is HYPOTHETICAL and unrelated to any actual broker balance.


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def finite(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (ValueError, TypeError):
        return None


def round_cash(value):
    return round(float(value), 6)


def default_state():
    return {
        "schema_version": 1,
        "mode": "PAPER",
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "funding_source": "VIRTUAL_ONLY",
        "initial_paper_cash_usdt": CONFIG["initial_paper_cash_usdt"],
        "trading_cash_usdt": CONFIG["initial_paper_cash_usdt"],
        "profit_reserve_usdt": 0.0,
        "positions": [],
        "closed_trades": [],
        "processed_signals": [],
        "events": [],
        "last_checked_at": None,
        "last_status": "Waiting for first cycle",
        "config": dict(CONFIG)
    }


def load_state(path):
    if not path.exists():
        return default_state()
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("mode") != "PAPER" or state.get("live_execution_enabled") is not False:
        raise RuntimeError("Fail closed: only PAPER mode is supported")
    if state.get("withdrawals_enabled") is not False or state.get("funding_source") != "VIRTUAL_ONLY":
        raise RuntimeError("Fail closed: external funding/withdrawal must remain disabled")
    for key in ("positions", "closed_trades", "processed_signals", "events"):
        if not isinstance(state.get(key), list):
            raise RuntimeError("Invalid state field: " + key)
    for key in ("trading_cash_usdt", "profit_reserve_usdt"):
        if finite(state.get(key)) is None or float(state[key]) < 0:
            raise RuntimeError("Invalid virtual cash state")
    state["config"] = dict(CONFIG)
    return state


def append_event(state, at, kind, details):
    state["events"].append({"time": at.isoformat(), "type": kind, "details": str(details)[:300]})
    state["events"] = state["events"][-50:]


def fetch_public_price(pair):
    if not pair.isalnum() or not pair.endswith("USDT") or len(pair) > 19:
        raise ValueError("Unrecognised Binance Spot pair")
    url = MARKET_API + "/ticker/price?" + urllib.parse.urlencode({"symbol": pair})
    req = urllib.request.Request(url, headers={"User-Agent": "TradeDesk-PaperCycle/1.0"})
    with urllib.request.urlopen(req, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("symbol") != pair:
        raise ValueError("Ticker mismatch")
    price = finite(body.get("price"))
    if price is None or price <= 0:
        raise ValueError("Bad quote")
    return price


def signal_qualifies(row):
    if not isinstance(row, dict) or row.get("status") != "BREAKOUT WATCH":
        return False
    pair = str(row.get("pair", ""))
    if not pair.endswith("USDT") or not pair[:-4].isalnum() or len(pair) > 19:
        return False
    if row.get("source") != "Binance Spot public API" or row.get("warnings"):
        return False
    score = finite(row.get("score"))
    change = finite(row.get("change_24h_pct"))
    move = finite(row.get("move_4h_pct"))
    volume = finite(row.get("quote_volume_usdt"))
    ratio = finite(row.get("volume_ratio"))
    spread = finite(row.get("spread_pct"))
    rsi = finite(row.get("rsi_1h"))
    reference = finite(row.get("price_usdt"))
    return (
        score is not None and score >= CONFIG["min_radar_score"]
        and reference is not None and reference > 0
        and row.get("breakout_20h") is True
        and row.get("above_sma20h") is True
        and change is not None and 1.5 <= change <= 7
        and move is not None and 0 < move < 5
        and volume is not None and volume >= 50_000_000
        and ratio is not None and ratio >= 1.8
        and spread is not None and 0 <= spread <= 0.12
        and rsi is not None and 48 <= rsi <= 68
    )


def daily_metrics(state, now):
    today = now.date().isoformat()
    entries = sum(1 for e in state["events"] if e["type"] == "PAPER_BUY"
                  and str(e["time"]).startswith(today))
    loss = sum(min(0, float(x["pnl_usdt"])) for x in state["closed_trades"]
               if str(x.get("closed_at", "")).startswith(today))
    return entries, loss


def simulate_sell(state, position, market_price, now, reason):
    slippage = CONFIG["simulated_slippage_fraction_each_side"]
    fee = CONFIG["simulated_fee_fraction_each_side"]
    exit_price = market_price * (1 - slippage)
    gross_proceeds = float(position["quantity"]) * exit_price
    exit_fee = gross_proceeds * fee
    proceeds = gross_proceeds - exit_fee
    pnl = proceeds - float(position["cost_usdt"])
    state["trading_cash_usdt"] = round_cash(state["trading_cash_usdt"] + proceeds)
    reserved = max(0.0, pnl)
    # Reserve profits INSIDE the virtual ledger; do not transfer real funds.
    state["profit_reserve_usdt"] = round_cash(state["profit_reserve_usdt"] + reserved)
    state["trading_cash_usdt"] = round_cash(max(0, state["trading_cash_usdt"] - reserved))
    closed = {
        **position,
        "closed_at": now.isoformat(), "exit_reason": reason,
        "exit_price_usdt": round(exit_price, 8),
        "exit_fee_usdt": round_cash(exit_fee),
        "proceeds_usdt": round_cash(proceeds),
        "pnl_usdt": round_cash(pnl),
        "reserved_profit_usdt": round_cash(reserved)
    }
    state["closed_trades"].append(closed)
    state["closed_trades"] = state["closed_trades"][-100:]
    append_event(state, now, "PAPER_SELL", "%s %s P/L %.4f USDT; %.4f reserved" %
                 (position["pair"], reason, pnl, reserved))
    return closed


def simulate_buy(state, row, market_price, now, signal_id):
    fee_rate = CONFIG["simulated_fee_fraction_each_side"]
    slippage = CONFIG["simulated_slippage_fraction_each_side"]
    equity = (state["trading_cash_usdt"] + state["profit_reserve_usdt"] +
              sum(float(p["cost_usdt"]) for p in state["positions"]))
    risk_budget = equity * CONFIG["max_single_trade_risk_fraction"]
    max_risk_position = risk_budget / CONFIG["stop_loss_fraction"]
    notional = min(
        CONFIG["max_position_usdt"],
        state["trading_cash_usdt"] * CONFIG["max_allocation_fraction"],
        max_risk_position,
        state["trading_cash_usdt"] / (1 + fee_rate)
    )
    # Micro-orders below typical venue minimums are not even paper-executed.
    if notional < 5:
        return False
    entry = market_price * (1 + slippage)
    buy_fee = notional * fee_rate
    cost = notional + buy_fee
    qty = notional / entry
    if cost > state["trading_cash_usdt"] + 1e-7:
        return False
    position = {
        "signal_id": signal_id, "pair": row["pair"],
        "ticker": row["ticker"], "opened_at": now.isoformat(),
        "quantity": qty, "entry_price_usdt": round(entry, 8),
        "cost_usdt": round_cash(cost), "buy_fee_usdt": round_cash(buy_fee),
        "stop_loss_usdt": round(entry * (1 - CONFIG["stop_loss_fraction"]), 8),
        "take_profit_usdt": round(entry * (1 + CONFIG["take_profit_fraction"]), 8),
        "expires_at": (now + timedelta(hours=CONFIG["max_hold_hours"])).isoformat(),
        "paper_only": True
    }
    state["trading_cash_usdt"] = round_cash(state["trading_cash_usdt"] - cost)
    state["positions"].append(position)
    state["processed_signals"].append(signal_id)
    state["processed_signals"] = state["processed_signals"][-200:]
    append_event(state, now, "PAPER_BUY", "%s simulated buy %.4f USDT; stop %.6f target %.6f" %
                 (row["pair"], cost, position["stop_loss_usdt"], position["take_profit_usdt"]))
    return True


def run_cycle(state, radar, get_price, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Time must be timezone-aware")
    if state.get("mode") != "PAPER" or state.get("live_execution_enabled") is not False:
        raise RuntimeError("No real-money implementation exists")
    if state.get("withdrawals_enabled") is not False:
        raise RuntimeError("Withdrawals forbidden")
    state["last_checked_at"] = now.isoformat()

    # EXIT FIRST, even if market radar is unavailable or stale.
    keep = []
    any_exit = False
    for position in state["positions"]:
        try:
            price = float(get_price(position["pair"]))
            if not math.isfinite(price) or price <= 0:
                raise ValueError("Invalid market quote")
        except (OSError, ValueError, TypeError, KeyError) as exc:
            keep.append(position)
            append_event(state, now, "QUOTE_ERROR", position["pair"] + " " + type(exc).__name__)
            continue
        target = float(position["take_profit_usdt"])
        stop = float(position["stop_loss_usdt"])
        expiry = parse_time(position["expires_at"])
        if price <= stop:
            simulate_sell(state, position, price, now, "STOP_LOSS")
            any_exit = True
        elif price >= target:
            simulate_sell(state, position, price, now, "TAKE_PROFIT")
            any_exit = True
        elif expiry and now >= expiry:
            simulate_sell(state, position, price, now, "MAX_HOLD")
            any_exit = True
        else:
            keep.append(position)
    state["positions"] = keep
    if any_exit:
        state["last_status"] = "Paper position exited; proceeds returned to virtual cash"
    if state["positions"]:
        state["last_status"] = "Monitoring open paper position"
        return state

    if not isinstance(radar, dict) or radar.get("execution_enabled") is not False:
        state["last_status"] = "No safe research snapshot: no entry"
        return state
    stamp = parse_time(radar.get("generated_at"))
    if not stamp or now < stamp or (now - stamp) > timedelta(minutes=CONFIG["max_radar_age_minutes"]):
        state["last_status"] = "Research snapshot stale: no entry"
        return state

    entries, loss = daily_metrics(state, now)
    if entries >= CONFIG["max_daily_entries"]:
        state["last_status"] = "Daily trade limit reached"
        return state
    max_daily_loss = CONFIG["initial_paper_cash_usdt"] * CONFIG["max_daily_loss_fraction"]
    if loss <= -max_daily_loss:
        state["last_status"] = "Daily loss limit reached"
        return state
    if len(state["positions"]) >= CONFIG["max_positions"]:
        state["last_status"] = "Maximum concurrent positions reached"
        return state
    rows = radar.get("crypto", {}).get("data", [])
    if not isinstance(rows, list):
        state["last_status"] = "Invalid research data: no entry"
        return state
    for row in sorted(rows, key=lambda r: -float(finite(r.get("score")) or 0)):
        if not signal_qualifies(row):
            continue
        signal_id = str(radar["generated_at"]) + "|" + row["pair"]
        if signal_id in state["processed_signals"]:
            continue
        last_trade = next((t for t in reversed(state["closed_trades"])
                           if t["pair"] == row["pair"]), None)
        if last_trade:
            closed = parse_time(last_trade.get("closed_at"))
            if closed and now - closed < timedelta(hours=CONFIG["same_coin_cooldown_hours"]):
                continue
        try:
            quote = float(get_price(row["pair"]))
            if not math.isfinite(quote) or quote <= 0:
                continue
        except (OSError, ValueError, TypeError, KeyError):
            continue
        reference = float(row["price_usdt"])
        if abs(quote / reference - 1) > CONFIG["max_price_change_from_scan_fraction"]:
            continue
        if simulate_buy(state, row, quote, now, signal_id):
            state["last_status"] = "Paper buy recorded; monitor target and stop"
            return state
    state["last_status"] = "No approved crypto setup; virtual funds remain in cash"
    return state


def save_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                     prefix=".cycle-", delete=False) as tmp:
        json.dump(content, tmp, indent=2, allow_nan=False)
        tmp.write("\n")
        temp = Path(tmp.name)
    os.replace(temp, path)


def main():
    parser = argparse.ArgumentParser(description="TradeDesk paper-only profit cycle")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--radar", type=Path, default=DEFAULT_RADAR)
    args = parser.parse_args()
    state = load_state(args.state)
    try:
        radar = json.loads(args.radar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        radar = None
    try:
        result = run_cycle(state, radar, fetch_public_price)
    except Exception as exc:
        # Do not rewrite corrupt funds balances. Let CI fail visibly.
        raise RuntimeError("Paper cycle failed; state not published") from exc
    save_json(args.state, result)
    print("Mode:", result["mode"], "|", result["last_status"])
    print("Trading cash:", result["trading_cash_usdt"],
          "| Reserved:", result["profit_reserve_usdt"],
          "| Open positions:", len(result["positions"]))


if __name__ == "__main__":
    main()
