"""Brings the 5-minute candles for both markets up to date.

Deriv only keeps about a year of candles, so this starts from the saved year in research/fvg-return/data
and adds every newer candle from Deriv. Nothing is invented: a market that cannot be fetched stops the run.

Run: python3 fetch_data.py
"""
import asyncio
import json
from pathlib import Path

import pandas as pd
import websockets

HERE = Path(__file__).parent
SAVED_YEAR_FOLDER = HERE.parent / "fvg-return" / "data"
OUTPUT_FOLDER = HERE / "data"
DERIV_ADDRESS = "wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089"
MARKETS = ("R_100", "1HZ100V")
CANDLE_SECONDS = 300
PAGE_SIZE = 5000
COLUMNS = ["time", "open", "high", "low", "close"]


async def newer_candles(symbol, after_time):
    """Downloads the candles that closed after the saved file ends."""
    request = {"ticks_history": symbol, "style": "candles", "granularity": CANDLE_SECONDS,
               "start": int(after_time) + 1, "end": "latest", "count": PAGE_SIZE}
    # A generous limit, so a stalled connection fails loudly instead of hanging.
    async with asyncio.timeout(60):
        async with websockets.connect(DERIV_ADDRESS) as connection:
            await connection.send(json.dumps(request))
            reply = json.loads(await connection.recv())
    if "candles" not in reply:
        raise RuntimeError(f"{symbol}: Deriv refused the request: {reply.get('error', {}).get('message')}")
    return pd.DataFrame(reply["candles"]).rename(columns={"epoch": "time"})[COLUMNS]


def without_unfinished_candle(candles):
    """Removes the last candle if it is still forming, so only closed candles are tested."""
    return candles.iloc[:-1]


def refresh(symbol):
    """Joins the saved year to the new candles and writes one clean file for the market."""
    saved = pd.read_csv(SAVED_YEAR_FOLDER / f"{symbol}_5m.csv")[COLUMNS]
    new = without_unfinished_candle(asyncio.run(newer_candles(symbol, saved.time.iloc[-1])))
    # Join, keep one row per time, and make sure they run oldest to newest.
    joined = pd.concat([saved, new]).drop_duplicates("time").sort_values("time")
    # Keep only candles that start exactly on a 5-minute mark (the very first saved row does not).
    joined = joined[joined.time % CANDLE_SECONDS == 0]
    joined.to_csv(OUTPUT_FOLDER / f"{symbol}_5m.csv", index=False)
    first, last = (pd.to_datetime(joined.time.iloc[i], unit="s") for i in (0, -1))
    print(f"{symbol}: {len(joined):,} candles, {first} to {last} UTC, {len(new):,} new")


if __name__ == "__main__":
    for market in MARKETS:
        refresh(market)
