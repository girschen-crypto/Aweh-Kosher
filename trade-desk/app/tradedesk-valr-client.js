/* TradeDesk VALR connection. Owner passphrase exists only during one browser request.
   Never enter your VALR API key or secret here; those live in Netlify settings. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const status = message => { $("valrConnectionStatus").textContent = message; };
  const clear = () => $("valrBalanceList").replaceChildren();
  function makeRow(b) {
    const row = document.createElement("div");
    row.className = "valr-row";
    const name = document.createElement("strong");
    name.textContent = b.currency;
    const amount = document.createElement("span");
    amount.textContent = "Available: " + (b.available ?? "Not provided") +
      " · Total: " + (b.total ?? "Not provided");
    row.append(name, amount);
    return row;
  }
  $("valrReadBalance").addEventListener("click", async () => {
    const tokenField = $("valrOwnerPassword");
    const token = tokenField.value.trim();
    tokenField.value = "";
    clear();
    if (token.length < 32) {
      status("Enter your separate TradeDesk owner password (at least 32 characters), not a VALR API key.");
      return;
    }
    $("valrReadBalance").disabled = true;
    status("Connecting to VALR securely...");
    try {
      const response = await fetch("/.netlify/functions/tradedesk-valr-balances", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const errors = {
          NOT_CONFIGURED: "The server is not yet configured. Add the three private Netlify environment variables.",
          ACCESS_DENIED: "Owner password incorrect. Use the password configured in Netlify.",
          INVALID_SERVER_CONFIGURATION: "The VALR server credentials need checking in Netlify.",
          VALR_CREDENTIALS_SWAPPED: "The VALR API key and secret appear to be in each other's Netlify fields. Swap them privately in Netlify and redeploy; never paste credentials into this page.",
          VALR_AUTH_FAILED: "VALR authentication failed (401). Your TradeDesk password was accepted. Check that the VALR key and secret belong together, are not swapped, and that the key was authorised by email and 2FA.",
          VALR_ACCESS_RESTRICTED: "VALR denied access (403). Check that View permission is enabled and the API key does not restrict Netlify's outgoing IP.",
          VALR_BALANCE_ACCESS_DENIED: "VALR accepts the API credentials but rejected balance access. Check the key's View permission and whether it belongs to the intended TradeDesk sub-account.",
          VALR_RATE_LIMITED: "VALR rate limit reached. Try later.",
          VALR_UNAVAILABLE: "VALR is not responding successfully.",
        };
        status(errors[data.error] || "VALR connection failed. No money has moved.");
        return;
      }
      if (!Array.isArray(data.balances)) throw new Error("Invalid balance response");
      if (!data.balances.length) status("Read-only connection successful. No balances returned by this VALR account.");
      else {
        status("Read-only VALR balances loaded at " + new Date(data.timestamp).toLocaleString() +
          ". These are exchange balances, NOT the virtual paper balance.");
        data.balances.forEach(b => $("valrBalanceList").append(makeRow(b)));
      }
    } catch (_) {
      status("Could not reach the secure balance function. No trading or deposits occurred.");
    } finally {
      $("valrReadBalance").disabled = false;
    }
  });
})();
