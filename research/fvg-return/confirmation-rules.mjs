// The fair value gap confirmation rules, shared by the Vix and gold studies so both test exactly the same thing.
import './study.mjs';

const { candles: candleTools } = globalThis.APA;
const CONFIRM_WINDOW_BARS = 5;
const TOUCH_WINDOW_BARS = 100;
const MINIMUM_RISK_RANGES = 0.25;
const CANDLE_STOP_BUFFER_RANGES = 0.25;

// Each confirmation looks only at candles that have already closed.
const isEngulfing = (list, index, buying) => (buying ? candleTools.isBullishEngulfing : candleTools.isBearishEngulfing)(list[index - 1], list[index]);
const isPinBar = (list, index, buying) => (buying ? candleTools.isBullishPinBar : candleTools.isBearishPinBar)(list[index]);
/** A candle in the trade's colour that closes back outside the gap, showing price was rejected there. */
const isRejectionClose = (list, index, buying, gap) => (buying ? candleTools.isBullish(list[index]) && list[index].close > gap.near : candleTools.isBearish(list[index]) && list[index].close < gap.near);
const isAnyConfirmation = (list, index, buying, gap) => isEngulfing(list, index, buying) || isPinBar(list, index, buying) || isRejectionClose(list, index, buying, gap);
export const CONFIRMATIONS = [['engulfing', isEngulfing, false], ['pin bar', isPinBar, false], ['rejection close', isRejectionClose, false], ['any of the three', isAnyConfirmation, false], ['any, with the trend', isAnyConfirmation, true]];
export const STOPS = ['gap', 'candle'];
export const TARGETS = [1, 2, 3];

/** Finds the first candle at or after index `from` that touches the gap. Returns -1 if none does in time. */
function firstTouch(list, gap) {
  const last = Math.min(list.length - 1, gap.index + TOUCH_WINDOW_BARS);
  for (let index = gap.index + 1; index <= last; index++) {
    if (gap.buying ? list[index].low <= gap.near : list[index].high >= gap.near) return index;
  }
  return -1;
}

/** Looks for a confirmation after the touch. A close through the gap's far edge cancels the setup. */
function findConfirmation(list, gap, touchIndex, confirms) {
  const last = Math.min(list.length - 2, touchIndex + CONFIRM_WINDOW_BARS - 1);
  for (let index = touchIndex; index <= last; index++) {
    if (gap.buying ? list[index].close < gap.far : list[index].close > gap.far) return -1;
    if (index > 0 && confirms(list, index, gap.buying, gap)) return index;
  }
  return -1;
}

/** Builds the trade rule. Entry is the open of the candle after confirmation, the first price anyone could really get. */
export const confirmationRule = (confirms, needsTrend, stopKind, rewardToRisk, trendAt) => (list, gap, average) => {
  if (needsTrend && trendAt[gap.index] !== (gap.buying ? 'up' : 'down')) return null;
  const touchIndex = firstTouch(list, gap);
  if (touchIndex < 0) return null;
  const confirmIndex = findConfirmation(list, gap, touchIndex, confirms);
  if (confirmIndex < 0) return null;
  const entryIndex = confirmIndex + 1;
  const entry = list[entryIndex].open;
  const buffer = average * (stopKind === 'gap' ? 0.5 : CANDLE_STOP_BUFFER_RANGES);
  const stop = stopKind === 'gap' ? (gap.buying ? gap.far - buffer : gap.far + buffer) : (gap.buying ? list[confirmIndex].low - buffer : list[confirmIndex].high + buffer);
  const risk = gap.buying ? entry - stop : stop - entry;
  if (risk < average * MINIMUM_RISK_RANGES) return null;
  return { entryIndex, entry, buying: gap.buying, stop, target: gap.buying ? entry + risk * rewardToRisk : entry - risk * rewardToRisk, maxBars: 500, enteredAtOpen: true };
};

