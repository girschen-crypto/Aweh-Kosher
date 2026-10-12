#!/usr/bin/env python3
"""Public-data market scanner. Research only: no credentials, orders or transfers."""
import csv
import io
import json
import math
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "market-radar.json"
UA = {"User-Agent": "MrG-TradeDesk-MarketResearch/1.0 (public data; no trading)"}
STOCKS = {
    "HOOD": "Robinhood Markets", "AVAV": "AeroVironment",
    "QCOM": "Qualcomm", "BWXT": "BWX Technologies", "MU": "Micron Technology",
    "NVDA": "NVIDIA", "MRVL": "Marvell Technology", "PLTR": "Palantir",
    "AMD": "Advanced Micro Devices", "GOOGL": "Alphabet",
    "MSFT": "Microsoft", "TSLA": "Tesla"
}
EXCLUDED = {"USDC", "FDUSD", "TUSD", "USDP", "DAI", "EUR", "EURC", "EURI",
            "TRY", "BUSD", "USTC", "PAXG", "WBTC", "XAUT", "USDE", "RLUSD"}


def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_text(url, timeout=18):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def number(v, default=0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (ValueError, TypeError):
        return default


def crypto_scan():
    endpoint = "https://data-api.binance.vision/api/v3/ticker/24hr"
    try:
        tickers = fetch_json(endpoint)
        if not isinstance(tickers, list):
            raise ValueError("Unexpected Binance ticker response")
        eligible = []
        for row in tickers:
            symbol = str(row.get("symbol", ""))
            if not symbol.endswith("USDT"):
                continue
            base = symbol[:-4]
            if (base in EXCLUDED or base.startswith(("USD", "EUR", "GBP")) or len(base) < 2 or
                    base.endswith(("UP", "DOWN", "BULL", "BEAR")) or
                    not base.isalnum() or len(base) > 14):
                continue
            change = number(row.get("priceChangePercent"))
            quote_volume = number(row.get("quoteVolume"))
            bid, ask = number(row.get("bidPrice")), number(row.get("askPrice"))
            spread = (ask - bid) / ((ask + bid) / 2) * 100 if bid > 0 and ask >= bid else 999
            if quote_volume < 25000000 or spread > 0.20 or number(row.get("count")) < 2500:
                continue
            if change < -4 or change > 13:
                continue
            eligible.append((row, change, quote_volume, spread))
        eligible.sort(key=lambda x: x[2], reverse=True)
        candidates = []
        # Get candles only for actively traded coins; 30 lightweight requests per run.
        for row, change, volume, spread in eligible[:30]:
            symbol = row["symbol"]
            try:
                klines = fetch_json(
                    "https://data-api.binance.vision/api/v3/klines?" +
                    urllib.parse.urlencode({"symbol": symbol, "interval": "1h", "limit": 52}),
                    timeout=12
                )
                # The final candle may be incomplete; ignore it.
                closed = klines[:-1]
                if len(closed) < 35:
                    continue
                closes = [number(k[4]) for k in closed]
                highs = [number(k[2]) for k in closed]
                vols = [number(k[7]) for k in closed]  # quote-asset turnover
                price = number(row.get("lastPrice"))
                if price <= 0:
                    continue
                recent_move = (closes[-1] / closes[-5] - 1) * 100 if closes[-5] else 0
                avg_volume = statistics.mean(vols[-25:-1]) or 1
                vol_ratio = vols[-1] / avg_volume
                changes = [closes[i] - closes[i-1] for i in range(-14, 0)]
                gains = statistics.mean(max(0, d) for d in changes)
                losses = statistics.mean(max(0, -d) for d in changes)
                rsi = 100 if losses == 0 else 100 - 100/(1 + gains/losses)
                previous_high = max(highs[-21:-1])
                breakout = closes[-1] > previous_high and previous_high > 0
                above_trend = closes[-1] > statistics.mean(closes[-20:])
                # Score measures candidates for diligence; it is NOT a return forecast.
                score = 0
                score += 18 if volume >= 50000000 else 10
                score += 18 if 1.5 <= change <= 7 else (8 if 0 <= change < 11 else 0)
                score += 23 if vol_ratio >= 1.8 else (14 if vol_ratio >= 1.25 else 0)
                score += 20 if breakout else 0
                score += 12 if 48 <= rsi <= 68 else (5 if 40 <= rsi < 75 else 0)
                score += 9 if above_trend else 0
                warning = []
                if rsi >= 75:
                    warning.append("Overbought 1h RSI")
                if change >= 9 or recent_move >= 7:
                    warning.append("Price may be extended")
                if change < 0 or recent_move < -2:
                    warning.append("Momentum conflict")
                if vol_ratio < 0.8:
                    warning.append("No volume confirmation")
                label = ("AVOID CHASING" if warning else
                         "BREAKOUT WATCH" if score >= 72 and breakout else
                         "EARLY WATCH" if score >= 55 else "MONITOR")
                if warning or score < 55 or not above_trend or recent_move <= 0:
                    continue
                candidates.append({
                    "ticker": symbol[:-4], "pair": symbol, "price_usdt": round(price, 8),
                    "change_24h_pct": round(change, 2), "move_4h_pct": round(recent_move, 2),
                    "quote_volume_usdt": round(volume), "volume_ratio": round(vol_ratio, 2),
                    "spread_pct": round(spread, 3), "rsi_1h": round(rsi, 1),
                    "breakout_20h": breakout, "above_sma20h": above_trend,
                    "score": score, "status": label, "warnings": warning,
                    "source": "Binance Spot public API", "interval": "1h closed candles"
                })
            except (OSError, ValueError, KeyError, IndexError, TypeError):
                continue
        candidates.sort(key=lambda x: -x["score"])
        return candidates[:12], None if candidates else "No liquid crypto pairs currently meet the breakout/momentum quality gate"
    except Exception as exc:
        return [], "Crypto feed unavailable: " + type(exc).__name__



def fetch_yahoo_bars(symbol):
    """Unofficial Yahoo daily candles; indicative historical data, never trade quotes."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?range=3mo&interval=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; personal research)"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    dataset = payload["chart"]["result"][0]
    timestamps = dataset["timestamp"]
    q = dataset["indicators"]["quote"][0]
    out = []
    for i, stamp in enumerate(timestamps):
        close = (q.get("close") or [])[i]
        high = (q.get("high") or [])[i]
        vol = (q.get("volume") or [])[i]
        if close is None or high is None:
            continue
        out.append({
            "Date": datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d"),
            "Close": close, "High": high, "Volume": vol or 0
        })
    return out


def stock_scan():
    results = []
    priced_count = 0
    for symbol, name in STOCKS.items():
        url = "https://stooq.com/q/d/l/?" + urllib.parse.urlencode({
            "s": symbol.lower() + ".us", "i": "d",
            "d1": (datetime.now(timezone.utc) - timedelta(days=140)).strftime("%Y%m%d")
        })
        try:
            source = "Stooq end-of-day CSV (delayed, unofficial)"
            try:
                content = fetch_text(url, timeout=8)
                prices = list(csv.DictReader(io.StringIO(content)))
            except (OSError, ValueError):
                prices = []
            prices = [r for r in prices if number(r.get("Close")) > 0]
            if len(prices) < 31:
                try:
                    prices = fetch_yahoo_bars(symbol)
                    source = "Yahoo Finance chart (unofficial, delayed)"
                except (OSError, ValueError, KeyError, TypeError, IndexError):
                    prices = []
            if len(prices) < 31:
                raise ValueError("No valid daily OHLCV data")
            prices.sort(key=lambda r: r["Date"])
            recent = prices[-1]
            day = datetime.strptime(recent["Date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - day).days > 7:
                continue
            close = number(recent["Close"])
            previous = number(prices[-2]["Close"])
            high20 = max(number(p["High"]) for p in prices[-21:-1])
            avg_vol = statistics.mean(number(p["Volume"]) for p in prices[-21:-1]) or 1
            vol_ratio = number(recent.get("Volume")) / avg_vol
            change = (close / previous - 1) * 100 if previous else 0
            breakout = close > high20
            trend = close > statistics.mean(number(r["Close"]) for r in prices[-21:-1])
            # Daily close source; not realtime or approved exchange execution quotes.
            score = (32 if breakout else 0) + (28 if vol_ratio >= 1.5 else 14 if vol_ratio >= 1.15 else 0) + (20 if trend else 0) + (20 if 0 < change < 6 else 0)
            risks = []
            if change >= 8:
                risks.append("Extended daily move")
            if change <= -4:
                risks.append("Sharp daily decline")
            status = ("CAUTION" if risks else "BREAKOUT WATCH" if score >= 70 and breakout else
                      "WATCH" if score >= 48 else "MONITOR")
            priced_count += 1
            results.append({
                "ticker": symbol, "name": name, "price_usd": round(close, 2),
                "day_change_pct": round(change, 2), "volume_ratio": round(vol_ratio, 2),
                "breakout_20d": breakout, "above_sma20d": trend, "score": score,
                "status": status, "warnings": risks, "as_of": recent["Date"],
                "source": source
            })
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            results.append({"ticker": symbol, "name": name, "price_usd": None,
                "day_change_pct": None, "volume_ratio": None, "breakout_20d": False,
                "above_sma20d": False, "score": 0, "status": "NEWS RESEARCH ONLY",
                "warnings": ["No verified daily price; not a buy signal"],
                "as_of": None, "source": "No available equity quote"})
    results.sort(key=lambda r: (r["status"] == "CAUTION", -r["score"]))
    return results, None if priced_count else "Equity prices unavailable; news research only"



def attach_news_leads(rows):
    """RSS headlines are research leads, not confirmation or buy signals."""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    for row in rows[:6]:
        query = '"' + row["name"] + '" stock when:7d'
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({
            "q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"
        })
        leads = []
        try:
            root = ET.fromstring(fetch_text(url, timeout=8))
            for item in root.findall("./channel/item")[:5]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                published = (item.findtext("pubDate") or "").strip()
                if not title or not link.startswith("https://news.google.com/"):
                    continue
                try:
                    age = datetime.now(timezone.utc) - parsedate_to_datetime(published)
                    if age < timedelta(0) or age > timedelta(days=7):
                        continue
                except (TypeError, ValueError, OverflowError):
                    continue
                leads.append({"headline": title[:220], "url": link,
                              "published": published, "source": "Google News RSS, unverified"})
                if len(leads) == 2:
                    break
        except (OSError, ValueError, ET.ParseError):
            pass
        row["headline_leads"] = leads
    return rows

def main():
    coins, crypto_error = crypto_scan()
    stocks, stock_error = stock_scan()
    stocks = attach_news_leads(stocks)
    document = {
        "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
        "execution_enabled": False, "recommendation": "RESEARCH ONLY",
        "notes": [
            "A high screen score is not a prediction or permission to invest.",
            "Crypto is Binance Spot public market data; stock prices are delayed US daily closes.",
            "Headlines, rumours and filings require independent verification before any trade.",
            "No broker keys, orders, transfers, leverage, margin, futures or withdrawals."
        ],
        "crypto": {"data": coins, "error": crypto_error},
        "stocks": {"data": stocks, "error": stock_error,
                   "excluded_markets": ["JSE data not integrated or verified"]}
    }
    OUTPUT.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Crypto candidates:", len(coins), "Stock candidates:", len(stocks))
    if crypto_error:
        print(crypto_error)
    if stock_error:
        print(stock_error)
    # If both fail, keep the record but fail the job for operational visibility.
    return 1 if crypto_error and stock_error else 0


if __name__ == "__main__":
    sys.exit(main())
