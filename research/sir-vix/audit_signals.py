"""Scores the group's posted signals against real Deriv 1-minute candles.

Chat times are Jamaica time (UTC-5). Where a signal gives no entry, the entry is the market price
when it was posted. Where it gives no target, it is scored at 1R, 2R and 3R. When the stop and the
target fall inside the same minute, the stop is counted first (we cannot see the order inside a candle).
"""
import json
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
JAMAICA_OFFSET = pd.Timedelta(hours=5)
FILL_WINDOW = pd.Timedelta(hours=24)
HOLD_WINDOW = pd.Timedelta(days=7)
DEFAULT_MULTIPLES = (1, 2, 3)


def load_minutes(symbol):
    frame = pd.read_csv(HERE / "data" / f"{symbol}_60.csv")
    frame.index = pd.to_datetime(frame.pop("time"), unit="s")
    return frame


def resolve_side(signal, price):
    if signal["side"] != "auto":
        return signal["side"]
    return "sell" if signal["stop"] > price else "buy"


def find_fill(candles, entry):
    touched = (candles.low <= entry) & (candles.high >= entry)
    if not touched.any():
        raise LookupError("entry price never reached")
    return touched.idxmax()


def first_hit(candles, side, stop, target):
    for time, bar in candles.iterrows():
        stop_hit = bar.high >= stop if side == "sell" else bar.low <= stop
        target_hit = bar.low <= target if side == "sell" else bar.high >= target
        if stop_hit:
            return "stop", time
        if target_hit:
            return "target", time
    return "open", None


def best_run_before_stop(candles, side, entry, risk, stop):
    stop_mask = candles.high >= stop if side == "sell" else candles.low <= stop
    until_stop = candles.loc[: stop_mask.idxmax()] if stop_mask.any() else candles
    move = entry - until_stop.low.min() if side == "sell" else until_stop.high.max() - entry
    return move / risk


def score_without_stop(signal, minutes, entry, filled_at):
    held = minutes.loc[filled_at: filled_at + HOLD_WINDOW]
    reached = held.high >= signal["target"] if signal["side"] == "buy" else held.low <= signal["target"]
    worst = entry - held.loc[: reached.idxmax()].low.min() if reached.any() else entry - held.low.min()
    return {
        **signal,
        "filled_utc": str(filled_at),
        "result": f"target reached after {reached.idxmax() - filled_at}" if reached.any() else "target never reached",
        "worst_drawdown_before_target_points": round(worst, 3),
    }


def score(signal):
    minutes = load_minutes(signal["symbol"])
    posted = pd.Timestamp(signal["posted"]) + JAMAICA_OFFSET
    after = minutes.loc[posted:]
    if after.empty:
        return {**signal, "result": "no data after post"}
    entry = signal["entry"] or after.iloc[0].close
    filled_at = find_fill(after.loc[: posted + FILL_WINDOW], entry) if signal["entry"] else after.index[0]
    if signal["stop"] is None:
        return score_without_stop(signal, minutes, entry, filled_at)
    side = resolve_side(signal, entry)
    risk = abs(entry - signal["stop"])
    wrong_side = (side == "sell" and signal["stop"] <= entry) or (side == "buy" and signal["stop"] >= entry)
    if wrong_side:
        return {**signal, "side": side, "entry": entry, "result": "stop already on the wrong side of price at post time"}
    held = minutes.loc[filled_at: filled_at + HOLD_WINDOW]
    targets = {}
    if signal["target"]:
        targets[f"{abs(signal['target'] - entry) / risk:.1f}R (his TP)"] = signal["target"]
    for multiple in DEFAULT_MULTIPLES:
        targets[f"{multiple}R"] = entry - multiple * risk if side == "sell" else entry + multiple * risk
    outcomes = {}
    for label, level in targets.items():
        outcome, when = first_hit(held, side, signal["stop"], level)
        outcomes[label] = outcome if when is None else f"{outcome} after {(when - filled_at)}"
    return {
        **signal,
        "side": side,
        "entry": round(entry, 4),
        "filled_utc": str(filled_at),
        "risk_points": round(risk, 4),
        "best_run_before_stop_R": round(best_run_before_stop(held, side, entry, risk, signal["stop"]), 2),
        "outcomes": outcomes,
    }


def score_or_explain(signal):
    try:
        return score(signal)
    except LookupError as reason:
        return {**signal, "result": str(reason)}


def main():
    signals = json.loads((HERE / "signals.json").read_text())
    results = [score_or_explain(signal) for signal in signals]
    (HERE / "output").mkdir(exist_ok=True)
    (HERE / "output" / "signal_audit.json").write_text(json.dumps(results, indent=2, default=str))
    for result in results:
        print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
