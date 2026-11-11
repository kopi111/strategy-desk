"""CINCO APA forward test: keeps score of the chosen settings on new data.

The backtest data stops on 2026-09-30, so every trade from 2026-10-01 on is on candles the settings
were never tuned on. Each run downloads fresh Deriv candles, replays the SAME rules the backtest and
the alert watcher use (confirm.run with signals-config.json), and writes every trade since that date to:
  output/forward/ledger.csv   one row per trade (closed or still open), spread already charged
  output/forward/REPORT.md    totals per setup and market, and the running profit in R

Run:  python3 forward_tracker.py                          gold + forex (signals-config.json)
      python3 forward_tracker.py --config signals-vix.json  Vix, written to output/forward-vix/
A settings file may set "forward_from" (first trade date to count) and "backtest_note" (what to compare with).
"""
from datetime import datetime, timezone
from pathlib import Path

import markdown
import pandas as pd

from confirm import run
from watch_signals import CONFIG_FILE, DerivFeed, SECONDS, SUFFIX, spread_for, load_config

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "output" / f"forward{SUFFIX}"
LEDGER_FILE = OUT_DIR / "ledger.csv"
REPORT_FILE = OUT_DIR / "REPORT.md"
HTML_FILE = OUT_DIR / "REPORT.html"
PAGE_STYLE = """
body { font: 16px/1.5 system-ui, sans-serif; max-width: 900px; margin: 32px auto; padding: 0 16px;
       background: #111418; color: #e6e8eb; }
h1 { font-size: 26px; margin-bottom: 4px; }
strong { color: #fff; }
table { border-collapse: collapse; margin: 18px 0; width: 100%; }
th, td { border-bottom: 1px solid #2a2f36; padding: 8px 10px; text-align: left; }
th { color: #9aa3ad; font-weight: 600; }
td:has(+ td) { white-space: nowrap; }
code { background: #1d2228; padding: 1px 5px; border-radius: 4px; }
"""
UNSEEN_FROM = pd.Timestamp(load_config().get("forward_from", "2026-10-01"))  # first day after the backtest data
MIN_TRADES_TO_JUDGE = 30


def trades_for(feed, symbol, timeframe, settings):
    """Closed trades plus the open one (if any) for one market and timeframe, from UNSEEN_FROM on."""
    candles = feed.candles(symbol, SECONDS[timeframe])
    events = []
    closed = run(candles, confirm="break", window=1, spread=spread_for(symbol),
                 mintick=1e-6, events=events, **settings)
    closed["status"] = closed.net_R.gt(0).map({True: "win", False: "loss"})
    open_trade = open_position(events, closed)
    frame = pd.concat([closed, open_trade]) if open_trade is not None else closed
    frame = frame[frame.entry_time >= UNSEEN_FROM].copy()
    frame["market"], frame["tf"] = symbol.replace("frx", ""), timeframe
    return frame


def open_position(events, closed):
    """The last entry alert that has no closed trade yet is the position still running."""
    entries = [e for e in events if e["kind"] == "entry"]
    if not entries or entries[-1]["time"] in set(closed.entry_time):
        return None
    last = entries[-1]
    return pd.DataFrame([dict(entry_time=last["time"], side=last["side"], entry=last["entry"],
                              risk=abs(last["entry"] - last["stop"]), status="open")])


def build_ledger(config):
    """Every trade on every configured market and setup."""
    feed = DerivFeed()
    parts = []
    try:
        for timeframe, settings in config["setups"].items():
            for symbol in config["markets"]:
                try:
                    parts.append(trades_for(feed, symbol, timeframe, settings))
                except Exception as error:
                    print(f"   {symbol} {timeframe}: {error}", flush=True)
    finally:
        feed.close()
    columns = ["tf", "market", "entry_time", "exit_time", "side", "entry", "exit", "risk", "why", "status", "net_R"]
    non_empty = [part for part in parts if len(part)]
    if not non_empty:   # no trades yet: an empty ledger, not a crash
        return pd.DataFrame(columns=columns)
    ledger = pd.concat(non_empty).sort_values("entry_time")
    return ledger.reindex(columns=columns)


def summary_rows(closed, group_by):
    """Trades, win %, total R and profit factor per group."""
    rows = []
    for key, group in closed.groupby(group_by):
        wins, losses = group.net_R[group.net_R > 0].sum(), -group.net_R[group.net_R <= 0].sum()
        rows.append(f"| {' | '.join(key if isinstance(key, tuple) else (key,))} | {len(group)} | "
                    f"{(group.net_R > 0).mean() * 100:.0f}% | {group.net_R.sum():+.2f} | "
                    f"{wins / losses if losses else float('inf'):.2f} |")
    return rows


def write_report(ledger, config):
    """Plain-English score card."""
    closed = ledger[ledger.status != "open"]
    still_open = ledger[ledger.status == "open"]
    total = closed.net_R.sum()
    running = closed.sort_values("exit_time").net_R.cumsum()
    verdict = (f"Only {len(closed)} closed trades: too few to judge yet (need {MIN_TRADES_TO_JUDGE})."
               if len(closed) < MIN_TRADES_TO_JUDGE else
               "Enough trades to start judging: compare with the backtest " +
               config.get("backtest_note", "(2H about +0.46R a trade, 4H about +0.38R)."))
    lines = [
        f"# CINCO APA forward test{' (' + SUFFIX.strip('-') + ')' if SUFFIX else ''}",
        "",
        f"Settings from `{CONFIG_FILE.name}`. Trades since **{UNSEEN_FROM.date()}** (after the backtest data). "
        f"Updated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC.",
        f"R = multiples of the amount risked ({config['risk_percent']:g}% of ${config['balance']:g} = ${config['balance'] * config['risk_percent'] / 100:g} a trade, so +1R = that amount). Spread already charged.",
        "",
        f"**{len(closed)} closed trades, {(closed.net_R > 0).mean() * 100 if len(closed) else 0:.0f}% wins, "
        f"total {total:+.2f}R** (best point {running.max() if len(running) else 0:+.2f}R, "
        f"worst {running.min() if len(running) else 0:+.2f}R). Open now: {len(still_open)}.",
        "",
        verdict,
        "",
        "| Setup | Trades | Win % | Total R | PF |",
        "|---|---|---|---|---|",
        *summary_rows(closed, "tf"),
        "",
        "| Setup | Market | Trades | Win % | Total R | PF |",
        "|---|---|---|---|---|---|",
        *summary_rows(closed, ["tf", "market"]),
        "",
        "Open trades: " + (", ".join(f"{r.market} {r.tf} {'BUY' if r.side > 0 else 'SELL'} from {r.entry_time:%m-%d %H:%M}"
                                    for r in still_open.itertuples()) or "none"),
    ]
    REPORT_FILE.write_text("\n".join(lines) + "\n")
    write_html("\n".join(lines))


def write_html(report_markdown):
    """Same report as a page for the browser; it reloads itself every 5 minutes."""
    body = markdown.markdown(report_markdown, extensions=["tables"])
    body = body.replace("<td>+", '<td style="color:#4ade80">+').replace("<td>-", '<td style="color:#f87171">-')
    HTML_FILE.write_text(f"""<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="300"><title>CINCO APA forward test{SUFFIX}</title>
<style>{PAGE_STYLE}</style></head><body>{body}</body></html>""")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    config = load_config()
    ledger = build_ledger(config)
    ledger.to_csv(LEDGER_FILE, index=False)
    write_report(ledger, config)
    print(REPORT_FILE.read_text(), flush=True)


if __name__ == "__main__":
    main()
