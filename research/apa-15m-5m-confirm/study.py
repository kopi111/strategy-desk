"""Runs the 15m-setup / 5m-confirmation APA test on gold and on the Deriv Vix indices.

Honest-test steps (strategy-improvement-prompt.txt):
  1. the three 5m confirmation types, everything else plain (RR 1.5)
  2. one change at a time on the best type: ATR stop buffer, daily EMA50, RR 1 / 2, shorter window,
     London+NY hours (gold only)
  3. combine only the changes that helped on their own
Every choice is made on the FIRST half of the data; the second half is only a check.
Writes output/results_<groups>.csv, output/final_trades_<group>.csv and prints the tables.

Run:  python3 study.py            gold and Vix
      python3 study.py gold       only gold (or: vix)
"""
import math
import multiprocessing as mp
import sys
from pathlib import Path

import pandas as pd

from backtest_mtf import run, setups_15m

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
sys.path.insert(0, str(RESEARCH / "cinco-apa"))
from backtest import load_m1, resample  # noqa: E402
from watch_signals import SYNTHETICS  # noqa: E402  (spreads from js/core/instruments.js)

OUT = HERE / "output"
VIX = ["R_10", "R_15", "R_25", "R_30", "R_50", "R_75", "R_90", "R_100", "1HZ10V", "1HZ15V", "1HZ25V",
       "1HZ30V", "1HZ50V", "1HZ75V", "1HZ90V", "1HZ100V", "1HZ150V", "1HZ250V"]
SPLIT = {"gold": pd.Timestamp("2025-03-31"), "vix": pd.Timestamp("2026-05-03")}
LONDON_NEW_YORK_UTC = set(range(7, 20))
DATA = {}       # market -> dict(df5, setups, spread, mintick, group); filled before the workers fork
ideas_tried = 0


# ---------- data ----------

def load_vix_5m(symbol):
    path = RESEARCH / "fvg-return" / "data" / f"{symbol}_5m.csv"
    if not path.exists():
        return None
    frame = pd.read_csv(path)
    frame.index = pd.DatetimeIndex(pd.to_datetime(frame.time, unit="s")).floor("5min")
    frame = frame.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c"})[["o", "h", "l", "c"]]
    return frame[~frame.index.duplicated()].sort_index()


def load_all(groups):
    """15m and 5m candles both built from the same finer data, plus the 15m setups."""
    if "gold" in groups:
        gold_m1 = load_m1("XAUUSD")
        DATA["XAUUSD"] = dict(df5=resample(gold_m1, "5min"), df15=resample(gold_m1, "15min"),
                              spread=0.30, mintick=0.01, group="gold")
    for symbol in VIX if "vix" in groups else []:
        df5 = load_vix_5m(symbol)
        if df5 is None:
            print(f"   {symbol}: no 5m data, skipped", flush=True)
            continue
        DATA[symbol] = dict(df5=df5, df15=resample(df5, "15min"), spread=SYNTHETICS[symbol][0],
                            mintick=1e-6, group="vix")
    for market in DATA.values():
        market["setups"] = setups_15m(market.pop("df15"))


# ---------- running and scoring ----------

def run_one(job):
    market, settings = job
    data = DATA[market]
    trades = run(data["df5"], data["setups"], spread=data["spread"], mintick=data["mintick"], **settings)
    trades["market"] = market
    return trades


def run_group(pool, group, settings):
    markets = [m for m, d in DATA.items() if d["group"] == group]
    return pd.concat(pool.map(run_one, [(m, settings) for m in markets]))


def t_value(r):
    return r.mean() / r.std() * math.sqrt(len(r)) if len(r) > 2 and r.std() > 0 else 0.0


def score(trades, group, rr):
    """The numbers the prompt asks for, for one group of trades."""
    r = trades.net_R
    first = trades[trades.entry_time < SPLIT[group]].net_R
    second = trades[trades.entry_time >= SPLIT[group]].net_R
    by_market = trades.groupby("market").net_R.sum()
    equity = 200.0
    for value in trades.sort_values("exit_time").net_R:
        equity *= 1 + 0.01 * value
    return dict(trades=len(r), win=round((trades.gross_R > 0).mean() * 100, 1) if len(r) else 0,
                need=round(100 / (1 + rr), 1), net_R=round(r.sum(), 1), t=round(t_value(r), 2),
                half_A_R=round(first.sum(), 1), half_B_R=round(second.sum(), 1),
                t_A=round(t_value(first), 2), t_B=round(t_value(second), 2),
                markets_up=f"{(by_market > 0).sum()}/{len(by_market)}",
                stop_spreads=round(trades.stop_in_spreads.median(), 1) if len(r) else 0,
                usd_200=round(equity, 2))


def test(pool, group, name, settings, rows):
    global ideas_tried
    ideas_tried += 1
    trades = run_group(pool, group, settings)
    row = dict(group=group, idea=name, **score(trades, group, settings.get("rr", 1.5)))
    rows.append(row)
    print(f"   {group:4} {name:38} {row['trades']:5} tr  win {row['win']:5}% (need {row['need']})  "
          f"net {row['net_R']:+7.1f}R  t {row['t']:+.2f}  A {row['half_A_R']:+.1f} / B {row['half_B_R']:+.1f}  "
          f"mkts {row['markets_up']}  stop {row['stop_spreads']} spreads", flush=True)
    return row, trades


def study_group(pool, group, rows):
    print(f"\n== {group.upper()} ==", flush=True)
    base_settings = dict(rr=1.5)
    # step 1: which 5m confirmation candle
    step1 = {kind: test(pool, group, f"1 confirm={kind}", dict(base_settings, confirm=kind), rows)[0]
             for kind in ("break", "choch", "engulf")}
    best_kind = max(step1, key=lambda kind: step1[kind]["half_A_R"])
    base = dict(base_settings, confirm=best_kind)
    base_A = step1[best_kind]["half_A_R"]
    # step 2: one change at a time, kept only if it beats the base on the FIRST half
    changes = {"stop +0.5 ATR": dict(stop_atr=0.5), "daily EMA50 trend": dict(daily_ema=50),
               "RR 1.0": dict(rr=1.0), "RR 2.0": dict(rr=2.0), "window 1 x 15m": dict(window15=1)}
    if group == "gold":
        changes["London+NY hours"] = dict(hours=LONDON_NEW_YORK_UTC)
    kept = {}
    for name, change in changes.items():
        row, _ = test(pool, group, f"2 {best_kind} + {name}", dict(base, **change), rows)
        if row["half_A_R"] > base_A:
            kept[name] = (change, row["half_A_R"])
    # only one RR can be used: keep the better one
    rr_kept = [n for n in kept if n.startswith("RR")]
    for name in sorted(rr_kept, key=lambda n: kept[n][1])[:-1]:
        kept.pop(name)
    # step 3: combine what helped
    final = dict(base)
    for change, _ in kept.values():
        final.update(change)
    final_name = f"3 FINAL {best_kind}" + "".join(f" + {n}" for n in kept)
    final_row, final_trades = test(pool, group, final_name, final, rows)
    final_trades.to_csv(OUT / f"final_trades_{group}.csv", index=False)
    by_year = final_trades.groupby(final_trades.entry_time.dt.year).net_R.agg(["count", "sum"]).round(1)
    by_market = final_trades.groupby("market").net_R.agg(["count", "sum"]).round(1).sort_values("sum")
    print(f"\n   FINAL by year:\n{by_year.to_string()}\n\n   FINAL by market:\n{by_market.to_string()}", flush=True)


def main():
    groups = [g for g in ("gold", "vix") if g in sys.argv] or ["gold", "vix"]
    OUT.mkdir(exist_ok=True)
    load_all(groups)
    rows = []
    with mp.get_context("fork").Pool(max(2, mp.cpu_count() - 1)) as pool:
        for group in groups:
            study_group(pool, group, rows)
    pd.DataFrame(rows).to_csv(OUT / f"results_{'_'.join(groups)}.csv", index=False)
    print(f"\nIdeas tried: {ideas_tried}", flush=True)


if __name__ == "__main__":
    main()
