"""Backtest of the "CINCO APA - Invalidation Strategy" Pine v6 script.

Faithful port of the Pine logic, bar by bar:
  * pivots confirmed swingLength bars late (ta.pivothigh/pivotlow behaviour)
  * process_orders_on_close=true -> entry fills at the signal bar's close
  * strategy.exit is only placed on the next script run (position_size is still 0
    on the entry bar), so the stop/target is checked at that bar's close, then
    intrabar from the bar after, using TradingView's OHLC path rule
  * stop beats target only when the bar path reaches it first; gaps fill at the open
Costs: one spread per round trip (dashboard spreads). Results in R and in $ for the
script's own sizing (1% of equity per position, $1000 start).
"""
import glob, json, math, sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent / "backtest-3y"
SPREADS = {"XAUUSD": 0.30, "USDJPY": 0.012, "R_25": 1.2, "R_75": 25.0, "R_100": 0.4, "stpRNG2": 0.1}
DEFAULT_SPREAD = 0.00012
MINTICK = {"XAUUSD": 0.01, "USDJPY": 0.001}


def load_m1(symbol):
    # HistData M1: EST without DST -> UTC is +5h
    frames = []
    for f in sorted(glob.glob(str(ROOT / "m1" / f"DAT_ASCII_{symbol}_M1_*.csv"))):
        frames.append(pd.read_csv(f, sep=";", header=None, names=["t", "o", "h", "l", "c", "v"]))
    df = pd.concat(frames)
    df.index = pd.to_datetime(df.t, format="%Y%m%d %H%M%S") + pd.Timedelta(hours=5)
    df = df[~df.index.duplicated()].sort_index()
    return df.loc["2023-10-01":"2026-09-30", ["o", "h", "l", "c"]]


def load_deriv(symbol, seconds):
    raw = json.load(open(ROOT / "deriv" / f"{symbol}_{seconds}.json"))
    rows = raw["candles"] if isinstance(raw, dict) else raw
    df = pd.DataFrame(rows)
    df.index = pd.to_datetime(df["time"], unit="s")
    df = df.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c"})
    return df[["o", "h", "l", "c"]].astype(float).sort_index()


def resample(m1, rule):
    return m1.resample(rule).agg({"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()


def pivots(high, low, n):
    size = len(high)
    ph = np.full(size, np.nan)
    pl = np.full(size, np.nan)
    for i in range(2 * n, size):
        centre = i - n
        window_h = high[centre - n: i + 1]
        window_l = low[centre - n: i + 1]
        if high[centre] == window_h.max() and (window_h[n + 1:] < high[centre]).all() and (window_h[:n] <= high[centre]).all():
            ph[i] = high[centre]
        if low[centre] == window_l.min() and (window_l[n + 1:] > low[centre]).all() and (window_l[:n] >= low[centre]).all():
            pl[i] = low[centre]
    return ph, pl


def exit_on_bar(direction, o, h, l, c, stop, target):
    # TradingView path: if open is nearer the high, it goes O-H-L-C, else O-L-H-C
    if direction > 0:
        if o <= stop: return o, "stop"
        if o >= target: return o, "target"
        high_first = (h - o) < (o - l)
        if high_first:
            if h >= target: return target, "target"
            if l <= stop: return stop, "stop"
        else:
            if l <= stop: return stop, "stop"
            if h >= target: return target, "target"
    else:
        if o >= stop: return o, "stop"
        if o <= target: return o, "target"
        high_first = (h - o) < (o - l)
        if high_first:
            if h >= stop: return stop, "stop"
            if l <= target: return target, "target"
        else:
            if l <= target: return target, "target"
            if h >= stop: return stop, "stop"
    return None, None


def run(df, swing=5, rr=2.0, spread=DEFAULT_SPREAD, mintick=0.00001):
    o, h, l, c = (df[k].to_numpy() for k in "ohlc")
    ph, pl = pivots(h, l, swing)
    last_high = last_low = bull_inv = bear_inv = math.nan
    bull_active = bear_active = False
    position = 0; entry = stop_level = target = math.nan; exit_live = False
    entry_time = None; trades = []

    for i in range(1, len(c)):
        # --- broker: open position's exit order, intrabar (placed on an earlier run)
        if position != 0 and exit_live:
            price, why = exit_on_bar(position, o[i], h[i], l[i], c[i], stop_level, target)
            if price is not None:
                trades.append((entry_time, df.index[i], position, entry, price, abs(entry - stop_level), why))
                position = 0; exit_live = False

        # --- script run on bar close
        if not math.isnan(ph[i]): last_high = ph[i]
        if not math.isnan(pl[i]): last_low = pl[i]
        bull_break = not math.isnan(last_high) and c[i] > last_high and c[i - 1] <= last_high
        bear_break = not math.isnan(last_low) and c[i] < last_low and c[i - 1] >= last_low
        if bull_break and not math.isnan(last_low):
            bull_inv = last_low; bull_active = True; bear_active = False
        if bear_break and not math.isnan(last_high):
            bear_inv = last_high; bear_active = True; bull_active = False
        hidden_bull = bull_active and l[i] < bull_inv and c[i] > bull_inv
        hidden_bear = bear_active and h[i] > bear_inv and c[i] < bear_inv
        if bull_active and c[i] < bull_inv: bull_active = False
        if bear_active and c[i] > bear_inv: bear_active = False

        flat_at_run = position == 0
        new_position = 0
        if hidden_bull and flat_at_run:
            new_position = 1; new_stop = l[i]; bull_active = False
        if hidden_bear and flat_at_run:
            new_position = -1; new_stop = h[i]; bear_active = False
        # existing position: strategy.exit placed this run, fills at close if already through
        if position != 0 and not exit_live:
            risk = (entry - stop_level) * position
            if risk > mintick:
                target = entry + position * risk * rr
                exit_live = True
                hit = (c[i] <= stop_level or c[i] >= target) if position > 0 else (c[i] >= stop_level or c[i] <= target)
                if hit:
                    price = c[i]; why = "stop" if (price - entry) * position < 0 else "target"
                    trades.append((entry_time, df.index[i], position, entry, price, risk, why))
                    position = 0; exit_live = False
        # --- broker: entry at this bar's close (process_orders_on_close)
        if new_position != 0 and position == 0:
            position = new_position; entry = c[i]; stop_level = new_stop
            entry_time = df.index[i]; exit_live = False

    t = pd.DataFrame(trades, columns=["entry_time", "exit_time", "side", "entry", "exit", "risk", "why"])
    t["gross_R"] = (t.exit - t.entry) * t.side / t.risk
    t["net_R"] = t.gross_R - spread / t.risk
    t["ret"] = ((t.exit - t.entry) * t.side - spread) / t.entry  # return on notional
    return t, position != 0


def summarise(name, tf, t):
    if t.empty:
        return dict(market=name, tf=tf, trades=0)
    equity = 1000.0
    for r in t.ret:  # 1% of equity notional, as the script sizes it
        equity += equity * 0.01 * r
    net = t.net_R
    sd = net.std(ddof=1)
    cum = net.cumsum()
    return dict(market=name, tf=tf, trades=len(t), win=round((t.gross_R > 0).mean() * 100, 1),
                gross_R=round(t.gross_R.sum(), 1), net_R=round(net.sum(), 1),
                avg_R=round(net.mean(), 3), t_stat=round(net.mean() / sd * math.sqrt(len(t)), 2) if sd > 0 else 0,
                maxDD_R=round((cum.cummax() - cum).max(), 1),
                pf=round(net[net > 0].sum() / -net[net < 0].sum(), 2) if (net < 0).any() else float("inf"),
                med_risk_spreads=round((t.risk / SPREADS.get(name, DEFAULT_SPREAD)).median(), 1),
                dollars=round(equity - 1000, 2))


def main():
    rows, all_trades = [], []
    fx = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"]
    for sym in fx:
        m1 = load_m1(sym)
        for tf, rule in [("15m", "15min"), ("1H", "1h"), ("4H", "4h")]:
            t, _ = run(resample(m1, rule), spread=SPREADS.get(sym, DEFAULT_SPREAD), mintick=MINTICK.get(sym, 0.00001))
            t["market"], t["tf"] = sym, tf
            all_trades.append(t); rows.append(summarise(sym, tf, t))
            print(rows[-1], flush=True)
    for sym in ["R_25", "R_75", "R_100", "stpRNG2"]:
        for tf, sec in [("5m", 300), ("1H", 3600), ("4H", 14400)]:
            t, _ = run(load_deriv(sym, sec), spread=SPREADS[sym], mintick=0.01)
            t["market"], t["tf"] = sym, tf
            all_trades.append(t); rows.append(summarise(sym, tf, t))
            print(rows[-1], flush=True)
    out = Path(__file__).parent / "output"; out.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out / "summary.csv", index=False)
    pd.concat(all_trades).to_csv(out / "trades.csv", index=False)


if __name__ == "__main__":
    main()
