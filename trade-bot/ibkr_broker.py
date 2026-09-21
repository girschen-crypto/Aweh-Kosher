import os
import requests


class IBKRBroker:
    """
    Guarded IBKR Web API adapter.
    Live orders require an authenticated IBKR Client Portal Gateway or
    another supported IBKR Web API authentication flow.
    """

    def __init__(self):
        self.base_url = os.getenv("IBKR_BASE_URL", "https://localhost:5000/v1/api").rstrip("/")
        self.account_id = os.getenv("IBKR_ACCOUNT_ID", "").strip()
        self.verify = os.getenv("IBKR_VERIFY_SSL", "false").lower() == "true"
        self.live_gate = os.getenv("ENABLE_LIVE_ORDERS", "NO") == "YES_I_ACCEPT_LIVE_RISK"
        if not self.account_id:
            raise RuntimeError("IBKR_ACCOUNT_ID is required for live mode.")
        if not self.live_gate:
            raise RuntimeError("Live orders are locked. Set ENABLE_LIVE_ORDERS only after paper validation.")

    def what_if(self, conid: int, side: str, quantity: float, order_type="MKT", price=None):
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": order_type,
            "quantity": float(quantity),
            "tif": "DAY",
        }
        if price is not None and order_type != "MKT":
            order["price"] = float(price)
        url = f"{self.base_url}/iserver/account/{self.account_id}/orders/whatif"
        response = requests.post(url, json={"orders": [order]}, verify=self.verify, timeout=20)
        response.raise_for_status()
        return response.json()

    def place_order(self, conid: int, side: str, quantity: float, order_type="MKT", price=None):
        order = {
            "conid": int(conid),
            "side": side.upper(),
            "orderType": order_type,
            "quantity": float(quantity),
            "tif": "DAY",
        }
        if price is not None and order_type != "MKT":
            order["price"] = float(price)
        url = f"{self.base_url}/iserver/account/{self.account_id}/orders"
        response = requests.post(url, json={"orders": [order]}, verify=self.verify, timeout=20)
        response.raise_for_status()
        result = response.json()

        # IBKR can return a warning/reply request instead of an immediate order.
        # We intentionally stop here and do not auto-confirm warnings in V1.
        if isinstance(result, list) and result and result[0].get("id") and result[0].get("message"):
            raise RuntimeError(f"IBKR order requires manual warning confirmation: {result[0]['message']}")
        return result
