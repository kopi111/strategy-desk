"""Turns the search output into RESULTS.md and the equity and drawdown chart. Run after search.py."""
import inspect
import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from rules import RULE_FUNCTIONS

HERE = Path(__file__).parent
OUTPUT_FOLDER = HERE / "output"
RESULTS_FILE = HERE / "RESULTS.md"
CHART_FILE = OUTPUT_FOLDER / "equity_and_drawdown.png"
MARKETS = {"R_100": "Volatility 100", "1HZ100V": "Volatility 100 (1s)"}
RISK_PERCENT_PER_TRADE = 1.0
MINIMUM_TRADES_PERIOD_A = 60
LUCK_LIMIT = 0.05
TOP_COUNT = 10
SURFACE_COLOR = "#fcfcfb"
PRIMARY_INK = "#0b0b0b"
SECONDARY_INK = "#52514e"
GRID_COLOR = "#e5e4e0"
SERIES_COLOR = "#2a78d6"


def load_market(market):
    """Reads every output table for one market."""
    return {"tests": pd.read_csv(OUTPUT_FOLDER / f"all_tests_{market}.csv"),
            "trades": pd.read_csv(OUTPUT_FOLDER / f"chosen_trades_{market}.csv", parse_dates=["entry_time", "exit_time"])}


def share_at_or_above(values, real_value):
    """The fraction of shuffled histories that did as well as the real one, counting the real one so it is never 0."""
    return (int((values >= real_value).sum()) + 1) / (len(values) + 1)


def luck_comparison(luck, market):
    """Compares the real choice for a market with what the shuffled histories chose."""
    rows = luck[luck.market == market]
    real = rows[rows.seed < 0].iloc[0]
    shuffled = rows[rows.seed >= 0]
    return {"real": real, "shuffled": shuffled, "share_score": share_at_or_above(shuffled.score_A, real.score_A),
            "share_B": share_at_or_above(shuffled.net_R_B, real.net_R_B),
            "share_walk_forward": share_at_or_above(shuffled.net_R_walk_forward, real.net_R_walk_forward)}


def chosen_row(tests, detail):
    """Finds the chosen strategy's line in the all-tests table."""
    return tests[tests.setting == detail["chosen"]].iloc[0]


def pass_fail_checks(row, detail, luck):
    """The pass marks, set before the run. A strategy needs all of them to be called an edge."""
    walk_forward_r = luck["real"].net_R_walk_forward
    regimes = detail["regimes"]
    strategy_b_percent = row.net_r_B * RISK_PERCENT_PER_TRADE
    return [("Period A: profit, PF above 1.1, t at least 2", row.net_r_A > 0 and row.profit_factor_A > 1.1 and row.t_A >= 2),
            ("Unseen period B: profitable, PF above 1", row.net_r_B > 0 and row.profit_factor_B > 1),
            ("Walk-forward: profitable overall", walk_forward_r > 0),
            ("Still profitable with costs doubled", row.net_r_double_cost_all > 0),
            ("Profitable in bull, bear and sideways", all(value > 0 for value in regimes.values())),
            ("Year profit is larger than its worst drawdown", row.net_r_all > row.max_drawdown_r_all),
            ("Beats buy and hold in period B at 1% risk", strategy_b_percent > detail["buy_hold_percent_B"]),
            ("Beats luck on selection (under 5% of shuffles match it)", luck["share_score"] < LUCK_LIMIT),
            ("Beats luck on walk-forward (under 5% of shuffles match it)", luck["share_walk_forward"] < LUCK_LIMIT)]


def persistence(tests):
    """Whether settings that did well in A also did well in B, measured across all settings with enough trades."""
    enough = tests[tests.trades_A >= MINIMUM_TRADES_PERIOD_A]
    return {"tested": len(enough), "positive_A": int((enough.net_r_A > 0).sum()), "positive_B": int((enough.net_r_B > 0).sum()),
            "positive_both": int(((enough.net_r_A > 0) & (enough.net_r_B > 0)).sum()),
            "rank_correlation": float(enough.expectancy_r_A.corr(enough.expectancy_r_B, method="spearman"))}


def top_settings(tests):
    """The ten best by the period A score. Period B is shown beside them but played no part in the order."""
    eligible = tests[(tests.trades_A >= MINIMUM_TRADES_PERIOD_A) & (tests.t_A > 0)]
    return eligible.sort_values("score_A", ascending=False).head(TOP_COUNT)


def markdown_table(headers, rows):
    """Builds a Markdown table from headers and already formatted rows."""
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def period_columns(row, suffix):
    """One period of the chosen strategy, in the order of the metrics table."""
    return [f"{row[f'trades_{suffix}']:.0f}", f"{row[f'win_rate_{suffix}']:.1f}%", f"{row[f'profit_factor_{suffix}']:.2f}",
            f"{row[f'net_r_{suffix}']:+.1f}R", f"{row[f'max_drawdown_r_{suffix}']:.1f}R", f"{row[f'average_win_r_{suffix}']:+.2f}R",
            f"{row[f'average_loss_r_{suffix}']:+.2f}R", f"{row[f'reward_risk_{suffix}']:.2f}", f"{row[f'expectancy_r_{suffix}']:+.3f}R",
            f"{row[f'sharpe_{suffix}']:.2f}", f"{row[f't_{suffix}']:.2f}", f"{row[f'longest_win_streak_{suffix}']:.0f} / {row[f'longest_loss_streak_{suffix}']:.0f}",
            f"{row[f'cost_r_{suffix}']:.1f}R", f"{row[f'net_r_double_cost_{suffix}']:+.1f}R"]


def metrics_section(row):
    """All requested measurements of the chosen strategy, by period."""
    names = ["Total trades", "Win rate", "Profit factor", "Net profit", "Max drawdown", "Average win", "Average loss",
             "Realised reward:risk", "Expectancy per trade", "Sharpe (annual, daily R)", "t value", "Longest win / loss streak",
             "Spread + slippage paid", "Net with costs doubled"]
    columns = [period_columns(row, suffix) for suffix in ("A", "B", "all")]
    return markdown_table(["Measure", "Period A", "Period B (unseen)", "Whole year"],
                          [[name, *(column[i] for column in columns)] for i, name in enumerate(names)])


def rules_section(row):
    """States the chosen strategy precisely enough to follow by hand."""
    parameters = re.search(r"\((.*?)\)", row.setting).group(1) or "none"
    entry_rule = inspect.getdoc(RULE_FUNCTIONS[row.rule])
    exit_rule = ("Exit at the next candle's open after the opposite signal." if row.reward_risk == "opposite"
                 else f"Take profit at {float(row.reward_risk):g} times the stop distance from entry.")
    volatility = {"any": "No volatility filter.", "high": "Only when ATR/price is above its 200-candle median.",
                  "low": "Only when ATR/price is below its 200-candle median."}[row.volatility]
    return "\n".join([f"- **Entry:** {entry_rule} Parameters: {parameters}. Timeframe: {row.minutes} minutes.",
                      "- **Fill:** open of the candle after the signal candle closes. One trade at a time.",
                      f"- **Volatility filter:** {volatility}",
                      f"- **Stop-loss:** {row.stop_atr:g} x ATR(14, Wilder) of the signal candle's timeframe, from the fill.",
                      f"- **Exit:** {exit_rule} The stop can end the trade first; any trade still open after 200 candles closes at the next open."])


def top_table(tests):
    """The top ten for one market."""
    rows = [[position + 1, row.setting, f"{row.score_A:.2f}", f"{row.trades_A:.0f}", f"{row.win_rate_A:.1f}%", f"{row.profit_factor_A:.2f}",
             f"{row.net_r_A:+.1f}", f"{row.max_drawdown_r_A:.1f}", f"{row.sharpe_A:.2f}", f"{row.trades_B:.0f}", f"{row.win_rate_B:.1f}%",
             f"{row.profit_factor_B:.2f}", f"{row.net_r_B:+.1f}", f"{row.expectancy_r_B:+.3f}"]
            for position, row in enumerate(top_settings(tests).itertuples())]
    return markdown_table(["#", "Setting", "Score A", "Trades A", "Win A", "PF A", "Net R A", "DD A", "Sharpe A",
                           "Trades B", "Win B", "PF B", "Net R B", "Exp B"], rows)


def folds_table(folds):
    """What each walk-forward window chose and earned on data it had not seen."""
    return markdown_table(["Unseen window", "Chosen on earlier data", "Trades", "Net R"],
                          [[f"{fold['from'][:10]} to {fold['to'][:10]}", fold["setting"], fold["trades"], f"{fold['net_r']:+.1f}"] for fold in folds])


def checks_table(checks):
    """The pass or fail of each mark."""
    return markdown_table(["Check", "Result"], [[name, "PASS" if passed else "FAIL"] for name, passed in checks])


def luck_section(luck):
    """How the real choice compares with choices made on random-order candles."""
    real, shuffled = luck["real"], luck["shuffled"]
    return markdown_table(["Measure", "Real prices", "Median of shuffled", "Shuffled at or above real"],
                          [["Best selection score in A", f"{real.score_A:.2f}", f"{shuffled.score_A.median():.2f}", f"{luck['share_score']:.1%}"],
                           ["That choice in B (net R)", f"{real.net_R_B:+.1f}", f"{shuffled.net_R_B.median():+.1f}", f"{luck['share_B']:.1%}"],
                           ["Walk-forward (net R)", f"{real.net_R_walk_forward:+.1f}", f"{shuffled.net_R_walk_forward.median():+.1f}", f"{luck['share_walk_forward']:.1%}"]])


def market_section(market, name, frames, detail, luck):
    """The complete report for one market, returning its text and whether every check passed."""
    tests, row = frames["tests"], chosen_row(frames["tests"], detail)
    checks = pass_fail_checks(row, detail, luck)
    stats = persistence(tests)
    regimes = ", ".join(f"{key} {value:+.1f}R" for key, value in detail["regimes"].items())
    passed = all(result for _, result in checks)
    text = f"""## {name} ({market})

**{sum(result for _, result in checks)} of {len(checks)} checks passed: {"survived" if passed else "NOT an edge"}.**
Highest-ranked strategy from period A: `{row.setting}`

{rules_section(row)}

### Results of that strategy
{metrics_section(row)}

Whole year by condition: {regimes}. Buys {detail['buys_net_r']:+.1f}R, sells {detail['sells_net_r']:+.1f}R.
Buy and hold: period A {detail['buy_hold_percent_A']:+.1f}%, period B {detail['buy_hold_percent_B']:+.1f}%. At 1% risk per trade the strategy made about {row.net_r_A:+.1f}% and {row.net_r_B:+.1f}%, before compounding.

### Pass marks
{checks_table(checks)}

### Top 10, ranked on period A only
{top_table(tests)}

### Walk-forward
{folds_table(detail['folds'])}

### Luck check ({len(luck['shuffled'])} shuffled histories)
{luck_section(luck)}

### Did good settings stay good?
Of {stats['tested']:,} settings with at least {MINIMUM_TRADES_PERIOD_A} trades in A: {stats['positive_A']:,} made money in A, {stats['positive_B']:,} in B, {stats['positive_both']:,} in both. Rank correlation of expectancy between A and B: {stats['rank_correlation']:+.3f}.
"""
    return text, passed


def style_axis(axis, title, y_label):
    """Quiet grid and axes, so the line carries the attention."""
    axis.set_facecolor(SURFACE_COLOR)
    axis.set_title(title, loc="left", fontsize=11, color=PRIMARY_INK)
    axis.set_ylabel(y_label, fontsize=9, color=SECONDARY_INK)
    axis.grid(axis="y", color=GRID_COLOR, linewidth=0.8)
    axis.tick_params(colors=SECONDARY_INK, labelsize=8)
    for side in ("top", "right", "left"):
        axis.spines[side].set_visible(False)
    axis.spines["bottom"].set_color(GRID_COLOR)


def draw_chart(frames_by_market, details):
    """Draws each chosen strategy's equity and drawdown, one column per market, on separate axes."""
    figure, axes = plt.subplots(2, 2, figsize=(12, 6.5), sharex="col", gridspec_kw={"height_ratios": [2, 1]}, facecolor=SURFACE_COLOR)
    for column, market in enumerate(MARKETS):
        trades = frames_by_market[market]["trades"]
        equity = trades.net_r.cumsum()
        drawdown = equity - np.maximum.accumulate(np.concatenate(([0.0], equity.to_numpy())))[1:]
        split = pd.Timestamp(details[market]["split"])
        for row_axes, values in ((axes[0][column], equity), (axes[1][column], drawdown)):
            row_axes.plot(trades.exit_time, values, color=SERIES_COLOR, linewidth=2)
            row_axes.axvline(split, color=SECONDARY_INK, linewidth=1, linestyle="--")
        style_axis(axes[0][column], f"{MARKETS[market]}: cumulative profit", "R")
        style_axis(axes[1][column], "Drawdown", "R")
        axes[0][column].annotate("unseen period B starts", (split, 1), xycoords=("data", "axes fraction"), xytext=(5, -2),
                                 textcoords="offset points", fontsize=8, color=SECONDARY_INK, va="top")
    figure.autofmt_xdate(rotation=0, ha="center")
    figure.tight_layout()
    figure.savefig(CHART_FILE, dpi=130, facecolor=SURFACE_COLOR)


def header_text(details, verdicts):
    """The verdict and the method, shown at the top of the report."""
    survivors = [MARKETS[market] for market, passed in verdicts.items() if passed]
    verdict = f"Survived every check: {', '.join(survivors)}." if survivors else "No strategy survived. Do not trade any of these settings as an edge."
    first = next(iter(details.values()))
    return f"""# Volatility 100 and Volatility 100 (1s): wide strategy search

**Verdict: {verdict}**

## Method, fixed before the run
- **Data:** real Deriv 5-minute candles, {first['first_candle'][:10]} to {first['last_candle'][:10]}. Deriv keeps about one year.
- **Tests:** {first['settings_tested']:,} settings per market. 22 entry rules (trend, momentum, breakout, mean reversion, market structure, price action) x 4 timeframes x 3 stops x 4 exits x 3 volatility filters.
- **Periods:** A (to 30 Jun 2026) ranks and chooses. B (from {first['split'][:10]}) only scores the choice. Walk-forward repeats the choice 5 times from 1 Mar 2026.
- **Costs:** assumed 0.4 spread + 0.1 slippage per trade, no commission. Swap is not charged. Real MT5 values are unverified.
- **No look-ahead:** decisions use closed candles, fills use the next open, and a test confirms cutting off future candles changes no past signal. Stop beats target if both are hit inside one 5-minute candle.
- **Ranking:** t value in A multiplied by the share of 7 checks that were profitable (4 time slices, 3 market conditions), with at least {MINIMUM_TRADES_PERIOD_A} trades in A.
- **Luck check:** the identical search on shuffled candles, where no pattern can exist.

## Files
`output/all_tests_*.csv` (every setting and every measure), `output/chosen_trades_*.csv`, `output/walk_forward_trades_*.csv`, `output/luck_table.csv`, `output/equity_and_drawdown.png`. Code: `fetch_data.py`, `rules.py`, `engine.py`, `metrics.py`, `search.py`, `report.py`, `test_quant.py`.

## Limits
- One year of data, and period B was also the unseen period in earlier Vix studies, so it is not completely fresh.
- Spread and slippage are assumptions. Stop and target order inside a 5-minute candle is unknown, so the stop is assumed first.
- Deriv describes these markets as generated by a random number process, so the expected finding is no edge.

![Equity and drawdown](output/equity_and_drawdown.png)
"""


def main():
    """Builds the chart and the full report from the saved results."""
    luck = pd.read_csv(OUTPUT_FOLDER / "luck_table.csv")
    details = {detail["market"]: detail for detail in json.loads((OUTPUT_FOLDER / "chosen.json").read_text())}
    frames = {market: load_market(market) for market in MARKETS}
    sections, verdicts = [], {}
    for market, name in MARKETS.items():
        text, verdicts[market] = market_section(market, name, frames[market], details[market], luck_comparison(luck, market))
        sections.append(text)
    draw_chart(frames, details)
    RESULTS_FILE.write_text(header_text(details, verdicts) + "\n" + "\n".join(sections))
    print("Report written.", {MARKETS[market]: passed for market, passed in verdicts.items()})


if __name__ == "__main__":
    main()
