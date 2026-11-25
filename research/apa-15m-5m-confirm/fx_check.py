"""Out-of-market check: gold's FINAL settings, unchanged, on the 7 USD forex pairs (no tuning).
Writes output/fx_check.csv and output/fx_check_trades.csv."""
import multiprocessing as mp
import pandas as pd
import study
from study import DATA, OUT, load_m1, resample, run_one, score, setups_15m

PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"]
GOLD_FINAL = dict(confirm="choch", stop_atr=0.5, rr=2.0)
study.SPLIT["fx"] = study.SPLIT["gold"]


def load_pairs():
    for pair in PAIRS:
        m1 = load_m1(pair)
        spread, mintick = (0.012, 0.001) if pair == "USDJPY" else (0.00012, 0.00001)
        DATA[pair] = dict(df5=resample(m1, "5min"), setups=setups_15m(resample(m1, "15min")),
                          spread=spread, mintick=mintick, group="fx")


def main():
    load_pairs()
    with mp.get_context("fork").Pool(len(PAIRS)) as pool:
        trades = pd.concat(pool.map(run_one, [(pair, GOLD_FINAL) for pair in PAIRS]))
    trades.to_csv(OUT / "fx_check_trades.csv", index=False)
    rows = [dict(market=pair, **score(trades[trades.market == pair], "fx", 2.0)) for pair in PAIRS]
    rows.append(dict(market="ALL 7", **score(trades, "fx", 2.0)))
    table = pd.DataFrame(rows)
    table.to_csv(OUT / "fx_check.csv", index=False)
    print(table[["market", "trades", "win", "net_R", "t", "half_A_R", "half_B_R", "stop_spreads", "usd_200"]].to_string(index=False))


if __name__ == "__main__":
    main()
