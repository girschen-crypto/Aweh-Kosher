import os
import requests


class IBKRBroker:
    """
    Guarded IBKR Web API adapter.

    The bot never auto-confirms IBKR warning/reply messages. A warning stops
    execution so the user can review it. Retail Client Portal Gateway
    authentication still requires the user to authenticate with IBKR.
    """

    def __init__(self):
        self.base_url = os.getenv("IBKR_BASE_URL", "https://localhost:5000/v1/api").rstrip("/")
        self.account_id = os.getenv("IBKR_ACCOUNT_ID", "").strip()
        self.verify = os.getenv("IBKR_VERIFY_SSL", "false").lower() == "true"
        self.live_gate = os.getenv("ENABLE_LIVE_ORDERS", "NO") == "YES_I_ACCEPT_LIVE_RISK"
        if not self.account_id:
            raise RuntimeError("IBKR_ACCOUNT_ID is required for live mode.")

    def _get(self, path, **params):
        r = requests.get(
            f"{self.base_url}{path}",
            params=params or None,
            verify=self.verify,
            timeout=20,
        )
        r.raise_for_status()
        return r.json()

    def _post(self, path, payload):
        r = requests.post(
            f"{self.base_url}{path}",
            json=payload,
            verify=self.verify,
            timeout=20,
        )
        r.raise_for_status()
        return r.json()

    def auth_status(self):
        return self._get("/iserver/auth/status")

    def resolve_conid(self, ticker: str):
        rows = self._get("/iserver/secdef/search", symbol=ticker, secType="STK")
        ticker = ticker.upper()
        for row in rows if isinstance(rows, list) else []:
            symbol = str(row.get("symbol") or "").upper()
            if symbol == ticker:
                return int(row["conid"])
        raise RuntimeError(f"Could not resolve an IBKR stock contract for {ticker}.")

    def init_portfolio(self):
        return self._get("/portfolio/accounts")

    def positions(self):
        self.init_portfolio()
        rows = self._get(f"/portfolio2/{self.account_id}/positions")
        return rows if isinstance(rows, list) else []

    def position_for_conid(self, conid: int):
        for row in self.positions():
            try:
                if int(row.get("conid")) == int(conid):
                    return row
            except (TypeError, ValueError):
                pass
        return None

    def _check_warning(self, result):
        if isinstance(result, list) and result:
            first = result[0]
            if first.get("id") and first.get("message"):
                raise RuntimeError(
                    "IBKR requires a warning confirmation. V1 will not auto-confirm it: "
                    + str(first.get("message"))
                )
        return result

    def what_if_cash(self, conid: int, side: str, cash_usd: float):
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": "MKT",
            "cashQty": round(float(cash_usd), 2),
            "tif": "DAY",
        }
        return self._post(
            f"/iserver/account/{self.account_id}/orders/whatif",
            {"orders": [order]},
        )

    def place_cash_order(self, conid: int, side: str, cash_usd: float, coid: str):
        if not self.live_gate:
            raise RuntimeError("Live order gate is locked.")
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": "MKT",
            "cashQty": round(float(cash_usd), 2),
            "tif": "DAY",
            "cOID": coid[:64],
        }
        return self._check_warning(
            self._post(
                f"/iserver/account/{self.account_id}/orders",
                {"orders": [order]},
            )
        )

    def what_if_quantity(self, conid: int, side: str, quantity: float):
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": "MKT",
            "quantity": float(quantity),
            "tif": "DAY",
        }
        return self._post(
            f"/iserver/account/{self.account_id}/orders/whatif",
            {"orders": [order]},
        )

    def place_quantity_order(self, conid: int, side: str, quantity: float, coid: str):
        if not self.live_gate:
            raise RuntimeError("Live order gate is locked.")
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": "MKT",
            "quantity": float(quantity),
            "tif": "DAY",
            "cOID": coid[:64],
        }
        return self._check_warning(
            self._post(
                f"/iserver/account/{self.account_id}/orders",
                {"orders": [order]},
            )
        )
