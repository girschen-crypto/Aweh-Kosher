import copy
import unittest
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
engine_path = Path(__file__).resolve().parents[1] / "auto_cycle.py"
spec = importlib.util.spec_from_file_location("td_paper_cycle", engine_path)
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)


def candidate():
    return {
        "ticker": "BTC", "pair": "BTCUSDT", "source": "Binance Spot public API",
        "price_usdt": 100.0, "score": 86, "status": "BREAKOUT WATCH",
        "breakout_20h": True, "above_sma20h": True,
        "change_24h_pct": 3.5, "move_4h_pct": 2,
        "quote_volume_usdt": 150000000, "volume_ratio": 2.2,
        "spread_pct": 0.05, "rsi_1h": 61, "warnings": []
    }


def snapshot(ts=NOW):
    return {"schema_version": 1, "execution_enabled": False,
            "generated_at": ts.isoformat(), "crypto": {"data": [candidate()]}}


class ProfitCycleTests(unittest.TestCase):
    def test_buy_and_reserve_realised_profit(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        self.assertEqual(len(state["positions"]), 1)
        self.assertEqual(state["mode"], "PAPER")
        self.assertLess(state["trading_cash_usdt"], 25)
        cycle.run_cycle(state, snapshot(), lambda _: 105.0, NOW + timedelta(minutes=5))
        self.assertFalse(state["positions"])
        self.assertGreater(state["profit_reserve_usdt"], 0)
        self.assertAlmostEqual(state["trading_cash_usdt"], 25.0, places=4)
        self.assertEqual(state["closed_trades"][0]["exit_reason"], "TAKE_PROFIT")

    def test_stop_reduces_capital_and_does_not_fake_profit(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        cycle.run_cycle(state, snapshot(), lambda _: 97.0, NOW + timedelta(minutes=5))
        self.assertFalse(state["positions"])
        self.assertEqual(state["profit_reserve_usdt"], 0)
        self.assertLess(state["trading_cash_usdt"], 25)
        self.assertLess(state["closed_trades"][0]["pnl_usdt"], 0)
        self.assertEqual(state["closed_trades"][0]["exit_reason"], "STOP_LOSS")

    def test_stale_research_will_not_buy(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(NOW - timedelta(hours=4)), lambda _: 100.0, NOW)
        self.assertEqual(len(state["positions"]), 0)
        self.assertIn("stale", state["last_status"])

    def test_chasing_new_price_is_blocked(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(), lambda _: 102.0, NOW)
        self.assertFalse(state["positions"])

    def test_signal_idempotency(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW + timedelta(minutes=5))
        self.assertEqual(len(state["positions"]), 1)
        self.assertEqual(len([e for e in state["events"] if e["type"] == "PAPER_BUY"]), 1)

    def test_snapshot_cannot_override_paper_only(self):
        state = cycle.default_state()
        state["mode"] = "LIVE"
        with self.assertRaises(RuntimeError):
            cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        state = cycle.default_state()
        state["withdrawals_enabled"] = True
        with self.assertRaises(RuntimeError):
            cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)

    def test_unverified_radar_cannot_buy(self):
        state = cycle.default_state()
        proposed = snapshot()
        proposed["execution_enabled"] = True
        cycle.run_cycle(state, proposed, lambda _: 100.0, NOW)
        self.assertFalse(state["positions"])

    def test_gapped_stop_uses_worse_executed_price(self):
        state = cycle.default_state()
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        cycle.run_cycle(state, snapshot(), lambda _: 82.0, NOW + timedelta(minutes=5))
        self.assertLess(state["closed_trades"][0]["exit_price_usdt"], 83)
        self.assertLess(state["closed_trades"][0]["pnl_usdt"], -0.8)

    def test_daily_loss_gate(self):
        state = cycle.default_state()
        state["closed_trades"] = [{"closed_at": NOW.isoformat(), "pnl_usdt": -0.60, "pair": "SOLUSDT"}]
        cycle.run_cycle(state, snapshot(), lambda _: 100.0, NOW)
        self.assertFalse(state["positions"])
        self.assertIn("Daily loss limit", state["last_status"])


if __name__ == "__main__":
    unittest.main()
