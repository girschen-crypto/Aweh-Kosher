import json
from pathlib import Path
from datetime import datetime, timezone


class PaperBroker:
    def __init__(self, ledger_path: str, starting_cash: float, currency: str = "USD"):
        self.path = Path(ledger_path)
        self.currency = currency
        self.state = self._load(starting_cash)

    def _load(self, starting_cash: float):
        if self.path.exists():
            return json.loads(self.path.read_text())
        return {
            "cash": float(starting_cash),
            "currency": self.currency,
            "positions": {},
            "trades": [],
            "realized_pnl": 0.0,
            "daily_realized_pnl": {},
        }

    def _save(self):
        self.path.write_text(json.dumps(self.state, indent=2))

    def equity(self, prices=None):
        prices = prices or {}
        total = float(self.state["cash"])
        for ticker, pos in self.state["positions"].items():
            px = float(prices.get(ticker, pos.get("last_price", pos["avg_price"])))
            total += float(pos["qty"]) * px
        return total

    def symbol_exposure(self, ticker: str, price: float):
        pos = self.state["positions"].get(ticker)
        if not pos:
            return 0.0
        return float(pos["qty"]) * float(price)

    def buy(self, ticker: str, notional: float, price: float, meta=None):
        notional = min(float(notional), float(self.state["cash"]))
        if notional <= 0:
            raise ValueError("No paper cash available.")
        qty = notional / float(price)
        pos = self.state["positions"].get(ticker, {"qty": 0.0, "avg_price": 0.0})
        old_cost = float(pos["qty"]) * float(pos["avg_price"])
        new_qty = float(pos["qty"]) + qty
        new_cost = old_cost + notional
        self.state["positions"][ticker] = {
            "qty": new_qty,
            "avg_price": new_cost / new_qty,
            "last_price": float(price),
        }
        self.state["cash"] -= notional
        trade = self._trade("BUY", ticker, qty, price, notional, meta)
        self._save()
        return trade

    def sell(self, ticker: str, price: float, qty=None, meta=None):
        pos = self.state["positions"].get(ticker)
        if not pos or float(pos["qty"]) <= 0:
            raise ValueError(f"No paper position in {ticker}.")
        sell_qty = float(pos["qty"]) if qty is None else min(float(qty), float(pos["qty"]))
        proceeds = sell_qty * float(price)
        cost = sell_qty * float(pos["avg_price"])
        pnl = proceeds - cost
        remaining = float(pos["qty"]) - sell_qty
        if remaining <= 1e-12:
            self.state["positions"].pop(ticker, None)
        else:
            pos["qty"] = remaining
            pos["last_price"] = float(price)
        self.state["cash"] += proceeds
        self.state["realized_pnl"] += pnl
        day = datetime.now(timezone.utc).date().isoformat()
        self.state["daily_realized_pnl"][day] = self.state["daily_realized_pnl"].get(day, 0.0) + pnl
        trade = self._trade("SELL", ticker, sell_qty, price, proceeds, {**(meta or {}), "realized_pnl": pnl})
        self._save()
        return trade

    def _trade(self, side, ticker, qty, price, value, meta=None):
        trade = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "side": side,
            "ticker": ticker,
            "qty": qty,
            "price": float(price),
            "value": float(value),
            "currency": self.currency,
            "meta": meta or {},
        }
        self.state["trades"].append(trade)
        return trade
