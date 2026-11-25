"""Goal: 60%+ win rate AND profit after spread, APA 15m setup + 5m CHoCH confirmation.

A win = a trade that made money after the spread (break-even exits are NOT wins).
Ideas: smaller targets with wider stops, and taking part of the trade off early.
Choice rule: among ideas with 60%+ wins in the FIRST half, the one with the most R in the first half;
the second half is only a check. Gold's choice is then run unchanged on the 7 USD pairs.

Run:  python3 winrate_study.py     -> output/winrate_<group>.csv, prints the tables
"""
import multiprocessing as mp

import pandas as pd

import study
from study import DATA, OUT, SPLIT, load_all, run_one, t_value
from fx_check import PAIRS, load_pairs

BASE = dict(confirm="choch")
IDEAS = {
    "RR 1.0, stop 0.5 ATR":                    dict(rr=1.0, stop_atr=0.5),
    "RR 0.75, stop 0.5 ATR":                   dict(rr=0.75, stop_atr=0.5),
    "RR 0.75, stop 1.0 ATR":                   dict(rr=0.75, stop_atr=1.0),
    "RR 1.0, stop 1.0 ATR":                    dict(rr=1.0, stop_atr=1.0),
    "RR 0.5, stop 1.0 ATR":                    dict(rr=0.5, stop_atr=1.0),
    "half off at 1R, rest 2R, BE":             dict(rr=2.0, stop_atr=0.5, partial_at=1.0, partial_size=0.5),
    "half off at 0.75R, rest 1.5R, BE":        dict(rr=1.5, stop_atr=0.5, partial_at=0.75, partial_size=0.5),
    "70% off at 0.5R, rest 2R, BE":            dict(rr=2.0, stop_atr=1.0, partial_at=0.5, partial_size=0.7),
    "RR 0.75, stop 1.0 ATR + daily EMA50":     dict(rr=0.75, stop_atr=1.0, daily_ema=50),
    "half off at 0.75R, rest 1.5R, BE + EMA50": dict(rr=1.5, stop_atr=0.5, partial_at=0.75, partial_size=0.5, daily_ema=50),
}
GOAL_WIN = 60.0


def score(trades, split):
    r = trades.net_R
    first, second = trades[trades.entry_time < split], trades[trades.entry_time >= split]
    equity = 500.0
    for value in trades.sort_values("exit_time").net_R:
        equity *= 1 + 0.01 * value
    win = lambda frame: round((frame.net_R > 0).mean() * 100, 1) if len(frame) else 0.0
    return dict(trades=len(r), win=win(trades), win_A=win(first), win_B=win(second),
                net_R=round(r.sum(), 1), t=round(t_value(r), 2),
                R_A=round(first.net_R.sum(), 1), R_B=round(second.net_R.sum(), 1),
                markets_up=f"{(trades.groupby('market').net_R.sum() > 0).sum()}/{trades.market.nunique()}",
                usd_500=round(equity, 2))


def test_all(pool, group):
    markets = [m for m, d in DATA.items() if d["group"] == group]
    rows = []
    for name, idea in IDEAS.items():
        settings = dict(BASE, **idea)
        trades = pd.concat(pool.map(run_one, [(m, settings) for m in markets]))
        row = dict(idea=name, **score(trades, SPLIT[group]))
        rows.append(row)
        print(f"   {group:4} {name:42} {row['trades']:5} tr  win {row['win']:5}% (A {row['win_A']} / B {row['win_B']})  "
              f"net {row['net_R']:+7.1f}R  A {row['R_A']:+.1f} / B {row['R_B']:+.1f}  t {row['t']:+.2f}  "
              f"mkts {row['markets_up']}  $500->{row['usd_500']}", flush=True)
    table = pd.DataFrame(rows)
    table.to_csv(OUT / f"winrate_{group}.csv", index=False)
    eligible = table[(table.win_A >= GOAL_WIN) & (table.R_A > 0)]
    if eligible.empty:
        print(f"   -> {group}: no idea reached {GOAL_WIN}% wins with profit in the first half", flush=True)
        return None
    pick = eligible.sort_values("R_A").iloc[-1]
    passed = pick.win_B >= GOAL_WIN and pick.R_B > 0
    print(f"   -> {group} pick (chosen on half A): {pick.idea} | half B: win {pick.win_B}%, {pick.R_B:+.1f}R "
          f"-> {'PASSES' if passed else 'FAILS'} the check", flush=True)
    return pick.idea


def main():
    load_all(["gold", "vix"])
    load_pairs()
    study.SPLIT["fx"] = study.SPLIT["gold"]
    with mp.get_context("fork").Pool(max(2, mp.cpu_count() - 1)) as pool:
        print("\n== GOLD ==", flush=True)
        gold_pick = test_all(pool, "gold")
        print("\n== VIX (18) ==", flush=True)
        test_all(pool, "vix")
        if gold_pick:
            settings = dict(BASE, **IDEAS[gold_pick])
            trades = pd.concat(pool.map(run_one, [(p, settings) for p in PAIRS]))
            print(f"\n== 7 USD PAIRS with gold's pick ({gold_pick}), unchanged ==", flush=True)
            for pair, group in trades.groupby("market"):
                row = score(group, SPLIT["gold"])
                print(f"   {pair}: {row['trades']} tr  win {row['win']}%  net {row['net_R']:+.1f}R  $500->{row['usd_500']}")
            row = score(trades, SPLIT["gold"])
            print(f"   ALL 7: {row['trades']} tr  win {row['win']}%  net {row['net_R']:+.1f}R  t {row['t']}  "
                  f"mkts {row['markets_up']}", flush=True)
            trades.to_csv(OUT / "winrate_fx_trades.csv", index=False)


if __name__ == "__main__":
    main()
