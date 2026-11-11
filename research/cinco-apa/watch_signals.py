"""CINCO APA trade alerts: tells you when to take a trade.

Every few minutes it downloads Deriv candles for each market, runs the SAME rules as the backtest
(confirm.py) and alerts you when, on the candle that just closed:
  * SETUP  - a sweep happened and agrees with the trend: get ready, a confirmation candle may follow
  * ENTRY  - the confirmation candle closed: take the trade now (entry, stop, target, lot size given)
Alerts go to: this terminal, a desktop pop-up with a sound, signals.log, and Telegram if a bot is saved.

Run:  python3 watch_signals.py           keep watching (checks every 5 minutes)
      python3 watch_signals.py --once    check once and stop
      python3 watch_signals.py --recent  show the last entries the rules would have given (to check it works)
      python3 watch_signals.py --config signals-vix.json   use another settings file (e.g. the Vix one)
Settings (balance, risk, markets, timeframes): signals-config.json next to this file.
Each settings file keeps its own alert memory and log (signals-config -> signals.log, signals-vix -> signals-vix.log).
"""
import json
import math
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import websocket

from confirm import run

HERE = Path(__file__).resolve().parent


def config_path():
    """The settings file named after --config, or signals-config.json."""
    if "--config" in sys.argv:
        return HERE / sys.argv[sys.argv.index("--config") + 1]
    return HERE / "signals-config.json"


CONFIG_FILE = config_path()
# the original settings file keeps its original state/log names so nothing already saved is lost
SUFFIX = "" if CONFIG_FILE.stem == "signals-config" else "-" + CONFIG_FILE.stem.removeprefix("signals-")
STATE_FILE = HERE / "output" / f"signals{SUFFIX}-state.json"
LOG_FILE = HERE / f"signals{SUFFIX}.log"
INSTRUMENTS_FILE = HERE.parent.parent / "js" / "core" / "instruments.js"
CREDENTIALS_FILE = Path.home() / ".credentials" / "all-projects.env"
DERIV_ENDPOINTS = ["wss://red.derivws.com/websockets/v3?app_id=1089",
                   "wss://red.binaryws.com/websockets/v3?app_id=1089"]
SECONDS = {"15m": 900, "30m": 1800, "1H": 3600, "2H": 7200, "4H": 14400}
CANDLES_TO_LOAD = 3000
LOCAL_ZONE = ZoneInfo("America/Jamaica")

DEFAULT_CONFIG = {
    "balance": 200,
    "risk_percent": 1.0,
    "check_every_minutes": 5,
    "markets": ["frxXAUUSD", "frxEURUSD", "frxGBPUSD", "frxUSDJPY",
                "frxAUDUSD", "frxNZDUSD", "frxUSDCAD", "frxUSDCHF"],
    "setups": {
        "2H": {"rr": 1.5, "stop_buffer_atr": 0.5, "daily_ema": 50},
        "4H": {"rr": 1.5, "stop_buffer_atr": 0.5, "daily_ema": 0},
    },
    "alert_on_setup": True,
}

SPREADS = {"frxXAUUSD": 0.30, "frxUSDJPY": 0.012}
DEFAULT_SPREAD = 0.00012


def load_synthetics():
    """Spread and price decimals of each Deriv synthetic, from the dashboard's instruments.js."""
    found = re.findall(r"synthetic\('([^']+)', '[^']+', (\d+), [\d.]+, ([\d.e-]+)", INSTRUMENTS_FILE.read_text())
    return {symbol: (float(spread), int(decimals)) for symbol, decimals, spread in found}


SYNTHETICS = load_synthetics()


def spread_for(symbol):
    if symbol in SYNTHETICS:
        return SYNTHETICS[symbol][0]
    return SPREADS.get(symbol, DEFAULT_SPREAD)


def decimals_for(symbol):
    if symbol in SYNTHETICS:
        return SYNTHETICS[symbol][1]
    return 2 if symbol in ("frxXAUUSD", "frxUSDJPY") else 5


# ---------- settings and memory of alerts already sent ----------

def load_config():
    """Reads signals-config.json, creating it with the tested defaults the first time."""
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
    return {**DEFAULT_CONFIG, **json.loads(CONFIG_FILE.read_text())}


def load_seen():
    """Alerts already sent, so the same candle never alerts twice."""
    return set(json.loads(STATE_FILE.read_text())) if STATE_FILE.exists() else set()


def save_seen(seen):
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(sorted(seen)[-2000:]))


# ---------- Deriv candles ----------

class DerivFeed:
    """One Deriv connection; asks for candle history one request at a time."""

    def __init__(self):
        self.socket = None

    def connect(self):
        for url in DERIV_ENDPOINTS:
            try:
                self.socket = websocket.create_connection(url, timeout=30)
                return
            except Exception:
                continue
        raise ConnectionError("Cannot reach Deriv (tried red.derivws.com and red.binaryws.com)")

    def ask(self, request):
        """Sends one request; Deriv drops idle connections between checks, so reconnect and retry once."""
        for attempt in range(2):
            if self.socket is None:
                self.connect()
            try:
                self.socket.send(json.dumps(request))
                return json.loads(self.socket.recv())
            except Exception:
                self.socket = None
                if attempt == 1:
                    raise

    def candles(self, symbol, seconds):
        """Closed candles only: the candle still forming is dropped."""
        request = {"ticks_history": symbol, "style": "candles", "granularity": seconds,
                   "count": CANDLES_TO_LOAD, "end": "latest"}
        reply = self.ask(request)
        if "error" in reply:
            raise RuntimeError(f"Deriv {symbol} {seconds}s: {reply['error'].get('message')}")
        frame = pd.DataFrame(reply["candles"])
        frame.index = pd.to_datetime(frame.epoch, unit="s")
        frame = frame.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c"})
        frame = frame[["o", "h", "l", "c"]].astype(float)
        still_forming = frame.index[-1] + pd.Timedelta(seconds=seconds) > pd.Timestamp.now(tz="UTC").tz_localize(None)
        return frame.iloc[:-1] if still_forming else frame

    def close(self):
        if self.socket is not None:
            self.socket.close()


# ---------- lot size ----------

def risk_per_min_lot(symbol, distance, price):
    """Dollars lost if the stop is hit with the smallest lot (0.01)."""
    if symbol in SYNTHETICS:
        return distance * 0.01             # synthetics: 1 lot = $1 per point
    if symbol == "frxXAUUSD":
        return distance * 1.0              # 0.01 lot = 1 ounce
    if symbol.startswith("frxUSD"):
        return distance * 1000 / price     # 0.01 lot = 1,000 units, profit in the other currency
    return distance * 1000                 # 0.01 lot = 1,000 units, profit already in USD


def lot_advice(symbol, entry, stop, balance, risk_percent):
    """Lot size for the planned risk, or a warning when even 0.01 lot is too big."""
    planned = balance * risk_percent / 100
    per_min_lot = risk_per_min_lot(symbol, abs(entry - stop), entry)
    lots = math.floor(planned / per_min_lot) * 0.01
    if lots >= 0.01:
        note = " - check the MT5 minimum lot for this index" if symbol in SYNTHETICS else ""
        return f"Lot {lots:.2f} (risks ${lots / 0.01 * per_min_lot:.2f} = {risk_percent:g}% of ${balance:g}){note}"
    share = per_min_lot / balance * 100
    return (f"⚠ Even 0.01 lot risks ${per_min_lot:.2f} = {share:.1f}% of ${balance:g} "
            f"(plan is {risk_percent:g}% = ${planned:.2f}). Skip it, or accept the bigger risk.")


# ---------- alert wording ----------

def local_time(stamp):
    return stamp.tz_localize("UTC").tz_convert(LOCAL_ZONE).strftime("%b %d %I:%M %p")


def describe(event, symbol, timeframe, config):
    name = symbol.replace("frx", "")
    side = "BUY" if event["side"] > 0 else "SELL"
    digits = decimals_for(symbol)
    reward = config["setups"][timeframe]["rr"]
    price = lambda value: f"{value:.{digits}f}"
    if event["kind"] == "setup":
        trigger = event["high"] if event["side"] > 0 else event["low"]
        cancel = event["low"] if event["side"] > 0 else event["high"]
        return (f"GET READY - {name} {timeframe} possible {side}\n"
                f"Sweep candle closed {local_time(event['time'])}.\n"
                f"Take it ONLY if the NEXT {timeframe} candle closes {'above' if event['side'] > 0 else 'below'} "
                f"{price(trigger)} as a {'green' if event['side'] > 0 else 'red'} candle.\n"
                f"Cancelled if it closes {'below' if event['side'] > 0 else 'above'} {price(cancel)}.")
    return (f"TAKE THE TRADE - {name} {timeframe} {side}\n"
            f"Confirmation candle closed {local_time(event['time'])}.\n"
            f"Entry {price(event['entry'])} (market now)\n"
            f"Stop {price(event['stop'])}\n"
            f"Target {price(event['target'])} ({reward:g} x risk)\n"
            f"{lot_advice(symbol, event['entry'], event['stop'], config['balance'], config['risk_percent'])}")


# ---------- where alerts go ----------

def telegram_credentials():
    if not CREDENTIALS_FILE.exists():
        return None
    values = dict(line.split("=", 1) for line in CREDENTIALS_FILE.read_text().splitlines()
                  if "=" in line and not line.startswith("#"))
    token = values.get("STRATEGY_DESK_TELEGRAM_BOT_TOKEN", "").strip()
    chat = values.get("STRATEGY_DESK_TELEGRAM_CHAT_ID", "").strip()
    return (token, chat) if token and chat else None


def send_telegram(text):
    credentials = telegram_credentials()
    if credentials is None:
        return
    token, chat = credentials
    import urllib.parse, urllib.request
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=20)
    except Exception as error:  # never print the address: it contains the token
        print(f"   (Telegram send failed: {type(error).__name__})")


def desktop_popup(title, text):
    subprocess.run(["kdialog", "--title", title, "--passivepopup", text, "60"], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["paplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def announce(text, popup=True):
    stamp = datetime.now(LOCAL_ZONE).strftime("%Y-%m-%d %I:%M %p")
    block = f"[{stamp}]\n{text}\n"
    print(block, flush=True)
    with LOG_FILE.open("a") as log:
        log.write(block + "\n")
    if popup:
        desktop_popup(text.splitlines()[0], "\n".join(text.splitlines()[1:]))
        send_telegram(text)


# ---------- checking the markets ----------

def events_for(feed, symbol, timeframe, settings):
    """Runs the backtest rules over recent candles and returns their setup/entry events."""
    candles = feed.candles(symbol, SECONDS[timeframe])
    events = []
    run(candles, confirm="break", window=1, spread=spread_for(symbol),
        mintick=1e-6, events=events, **settings)
    return candles, events


def trend_agrees(candles, event, settings):
    """Setups are only worth a heads-up if the daily trend filter would let the entry through."""
    if not settings.get("daily_ema"):
        return True
    daily = candles.c.resample("1D").last().dropna().ewm(span=settings["daily_ema"], adjust=False).mean().shift(1)
    level = daily.reindex([event["time"].floor("1D")]).iloc[0]
    close = candles.c.loc[event["time"]]
    return not math.isnan(level) and (close - level) * event["side"] > 0


def check_once(feed, config, seen):
    for timeframe, settings in config["setups"].items():
        for symbol in config["markets"]:
            try:
                candles, events = events_for(feed, symbol, timeframe, settings)
            except Exception as error:
                print(f"   {symbol} {timeframe}: {error}", flush=True)
                continue
            last_closed = candles.index[-1]
            for event in events:
                if event["time"] != last_closed:
                    continue
                if event["kind"] == "setup" and (not config["alert_on_setup"] or not trend_agrees(candles, event, settings)):
                    continue
                key = f"{symbol}|{timeframe}|{event['kind']}|{event['time'].isoformat()}"
                if key not in seen:
                    seen.add(key)
                    announce(describe(event, symbol, timeframe, config))
    save_seen(seen)


def show_recent(feed, config, how_many=10):
    """Prints the latest entries the rules gave, to check the watcher sees what the backtest sees."""
    found = []
    for timeframe, settings in config["setups"].items():
        for symbol in config["markets"]:
            _, events = events_for(feed, symbol, timeframe, settings)
            found += [(e["time"], symbol, timeframe, e) for e in events if e["kind"] == "entry"]
    for _, symbol, timeframe, event in sorted(found, key=lambda item: item[0])[-how_many:]:
        print(describe(event, symbol, timeframe, config) + "\n")


def main():
    config = load_config()
    feed = DerivFeed()
    if "--recent" in sys.argv:
        show_recent(feed, config)
        return
    seen = load_seen()
    print(f"Watching {len(config['markets'])} markets on {', '.join(config['setups'])}. "
          f"Balance ${config['balance']}, risk {config['risk_percent']}%. Ctrl+C to stop.", flush=True)
    while True:
        check_once(feed, config, seen)
        if "--once" in sys.argv:
            break
        print(f"   checked {datetime.now(LOCAL_ZONE).strftime('%I:%M %p')}", flush=True)
        time.sleep(config["check_every_minutes"] * 60)


if __name__ == "__main__":
    main()
