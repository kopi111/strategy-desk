# APA strategy: rules taken from the two videos

APA stands for "Advanced Price Action". Both presenters trade **pure price action**: no indicators, no Fibonacci.
Nothing in this file is invented. Where a video left a rule unclear or unexplained, the gap is marked **UNVERIFIED**
and the dashboard exposes it as a setting instead of hard-coding a guess.

Transcripts (auto-captions, pulled with yt-dlp on 2026-10-19) are in `research/`.

| | Video 1 | Video 2 |
|---|---|---|
| Title | A.P.A Trading Strategy Full Course (MSNR) | A.P.A Live Class Explaining The Full Strategy |
| Channel | Mr Leo Fx | Tradebyladen |
| Length | 2:32:53 | 1:03:32 |
| Markets shown | GBPUSD, Gold 1H, AUDUSD | Volatility 75 index (Deriv) |
| Start point requested | 17:31 (refining the OCL entry to a 15m/5m order block, 1:8 RR) | 8:27 (Invalidation retest + rejection on 5m/1m) |

## 1. Rules both videos share

| Rule | Where it is said | Code |
|---|---|---|
| Mark structure and levels on the higher time frame (daily, 4H, 1H); enter on the lower one (15m, 5m, 1m) | V1 0:00, 43:10; V2 20:41, 41:52 | `structureTimeframe`, `biasTimeframe`, `entryTimeframe` |
| Uptrend = higher highs + higher lows; downtrend = lower highs + lower lows | V2 0:31–1:32; V1 1:40:35 | `structure.js` swing walk |
| A break counts only when a candle **body closes** beyond the swing ("we don't want wicks") | V1 2:26:13; V2 12:29 ("close above this wick") | `breakRequires: 'close-beyond-wick'` |
| Levels are drawn on candle **bodies**, not wicks (switch to a line chart to see them) | V1 49:20, 1:13:49, 2:07:07; V2 7:16 | swing level = body top / body bottom |
| First break against the trend = change of character / market structure shift (CHoCH / MSS) | V1 48:17; V2 3:05 | `structure.js` event `CHOCH` |
| Wait for price to come to the level. No tap, no trade | V1 11:00, 1:36:27 | zone state `waiting` |
| Confirmation on the entry time frame: a rejection candle **or** a lower-time-frame change of character | V1 4:14, 1:37:28; V2 5:43, 39:40 | `confirmations` setting |
| Rejection candles named: engulfing (V2's favourite), pin bar, doji, inside bar, hanging man | V2 19:40, 41:22, 46:04 | `candles.js` patterns |
| Stop loss a few pips beyond the key level (or beyond the engulfing candle / structure wick) | V1 5:16, 44:12, 1:30:18; V2 43:27, 51:15 | `stopBufferRanges`, `stopBeyond` |
| Target at least 1:3; V1 turned down a 1:2 trade ("that one is a no") | V1 5:16, 19:20 | `minRewardToRisk = 3` |
| Close 50% at 1:3, move the stop to break-even, let the rest run to higher-time-frame liquidity | V1 37:00, 55:06, 1:42:09 | `partialAtR = 3`, `partialFraction = 0.5` |
| Final target = opposite liquidity on the higher time frame (previous 4H swing low/high, equal highs) | V1 18:48, 59:12, 1:53:36 | `targetTimeframe = bias` |
| Risk 1–2% of the account per trade | V1 16:42 | `riskPercent` default 1 |
| Trade with the higher-time-frame trend ("always trade according to the trend") | V1 45:12 | per-model `followBias` |
| Liquidity must be taken before entry ("if you don't spot the liquidity, you are the liquidity") | V1 9:26, 16:42, 1:14:20 | `requireLiquiditySweep` |
| Skip charts whose direction is unclear; not every pair respects every structure, so backtest per pair | V1 1:44:17; V2 24:27, 48:07 | Backtest tab, per-model results |

## 2. Entry models

Each model turns into a **zone**: a price level, a direction, and the bar where it became known. A zone becomes a
trade only after it is tapped and confirmed (section 3).

### Video 1 (Mr Leo Fx)

| Model | Setup | Key level | Direction | Time |
|---|---|---|---|---|
| **OCL** (open-close level) | Two consecutive impulsive candles of the same colour. Use the OCL closest to the latest break of structure, and only if it is still fresh (not traded back into) | The line where candle 1 closes and candle 2 opens | Bullish OCL → buy, bearish → sell | 2:07–30:11, 30:45–41:00 |
| **Resistance A formation** | Bearish market. Price rallies into supply, then gives a CHoCH down. Liquidity forms below the level and is taken | Body of the peak of the rally (the tip of the "A") | Sell | 41:37–1:06:58 |
| **Support V formation** | Break of structure up. A second break leaves liquidity above the level; that liquidity is swept | The lowest body point that started the break (the bottom of the "V") | Buy | 1:07:30–1:28:13 |
| **SBR** (support becomes resistance) | A support level price had been reacting from is broken by a body close | The old support | Sell on the retest | 1:28:13–1:47:55 |
| **RBS** (resistance becomes support) | Mirror of SBR | The old resistance | Buy on the retest | 1:47:55–1:58:21 |
| **QM sell / QM buy** | Uptrend (HH/HL), then the first CHoCH. Used to catch early reversals | The **left shoulder**: the high before the final high, drawn on the body | Sell (buy is the mirror) | 1:58:21–2:32:04 |

### Video 2 (Tradebyladen)

| Model | Setup | Key level | Time |
|---|---|---|---|
| **Invalidation** | Uptrend, then a market structure shift (price closes below the last higher low) | The **second-to-last high**, on the body. Same level as V1's QM left shoulder, so the code treats them as one model | 2:04–13:30 |
| **New invalidation** | Price never reaches the invalidation, forms a lower high, then breaks structure again | The new lower high. The old invalidation stays valid as a backup | 14:00–19:40 |
| **Invalidation X** | Uptrend makes a higher low but **fails** to make a higher high (lower high), then the higher low breaks | That failed lower high | 32:18–39:20 |

All three run in both directions ("it's vice versa").

## 3. From zone to trade (the code path)

1. **Zone appears** on the structure time frame when its break candle closes. No look-ahead: swings count only
   once `swingStrength` bars have closed after them.
2. **Bias check** (models with `followBias`): bias-time-frame trend must agree.
3. **Liquidity sweep** (when `requireLiquiditySweep` is on): after the zone appears, a structure swing between
   the level and price must be taken out before the tap.
4. **Tap**: an entry-time-frame candle reaches the level (within `tapToleranceRanges`).
5. **Invalidated** if an entry candle closes beyond the level by more than the stop buffer before confirming.
6. **Confirmation** within `confirmWindowBars` entry candles: engulfing, pin bar or entry-time-frame CHoCH
   (doji / inside bar optional, off by default).
7. **Entry** at the confirmation candle's close. **Stop** beyond the furthest of the level and the wick extreme
   since the tap, plus the buffer.
8. **Targets**: TP1 = 3R (close 50%, stop to break-even). Final = nearest opposite liquidity on the bias time
   frame. If that liquidity is closer than `minRewardToRisk`, the result is **NO TRADE**.
9. One trade per zone. No new trade while one is open on the same instrument.

## 4. Gaps left as settings (UNVERIFIED)

| Gap | Why | Default |
|---|---|---|
| "Daily confirmation" | V2 54:17 names it and says it is "a different class for another day" | Off, toggle in Settings |
| "Structure retest" / "break and retest" as separate models | V2 says they will be covered in a later class (1:01:04) | Covered by SBR/RBS only |
| How far is "a few pips" | Neither video gives a number | 0.5× the average entry-candle range |
| How many touches make a support/resistance level | V1 shows levels with several reactions, never a count | 2 |
| Swing size (how many bars either side) | Read by eye in both videos | 3 bars |
| How long a zone stays valid | V2: "a month, two months, even a year" | 300 structure bars |
| Trading sessions | Neither video names a session | None (analytics by session only) |
| Fair value gaps / order blocks | V1 mentions them as extra context, not as rules | Not used |

## 5. What this tool does not claim

The presenters only show winning examples, replayed in hindsight. The Backtest tab runs these rules over real (or
demo) candles so the numbers can be checked. Treat results as research, not financial advice.
