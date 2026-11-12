(function (APA) {
  'use strict';

  // Each lesson gives the simple idea first, then the detail, then what this Desk has found about it.
  // The "desk" lines come from the backtests in research/; they are results, not advice.
  const LESSONS = [
    {
      id: 'support-resistance',
      title: 'Support and resistance',
      simple: 'Prices where the market turned before. Support is a floor buyers defended, resistance is a ceiling sellers defended.',
      depth: [
        'Treat them as zones, not thin lines. Wicks poke through; closes matter more.',
        'A broken level often flips: old resistance becomes support (RBS) and old support becomes resistance (SBR).',
        'The more times a level is tested, the more stops gather behind it, so it can also break harder.',
      ],
      desk: 'The Chart page marks these zones for you and the APA rules use the SBR/RBS flip.',
      link: { view: 'rules', label: 'Strategy rules' },
    },
    {
      id: 'engulfing',
      title: 'Bullish and bearish engulfing',
      simple: 'A candle whose body fully covers the body of the candle before it, in the other colour. Green over red is bullish, red over green is bearish.',
      depth: [
        'On its own it means little. It only counts at a level you already marked.',
        'Judge the body, not the wicks, and wait for the candle to close.',
        'A large engulfing candle also means a wide stop, which shrinks your position size.',
      ],
      desk: 'Engulfing was one of 22 rules in the Volatility 100 search (research/vix100-quant). It found no edge on unseen data.',
    },
    {
      id: 'vwap',
      title: 'VWAP',
      simple: 'The average price of the day, weighted by how much traded at each price. Above it, buyers have been in control; below it, sellers.',
      depth: [
        'It resets at the session open, so it is a day-trading tool.',
        'Large funds use it as a benchmark, which is why price often reacts around it.',
        'It needs real traded volume to mean anything.',
      ],
      desk: 'Not on this Desk. Deriv synthetic indices have no real volume, and forex and gold volume from a broker is only a tick count, so VWAP there is a rough copy.',
    },
    {
      id: 'rsi-divergence',
      title: 'RSI and divergence',
      simple: 'RSI scores recent moves from 0 to 100. Divergence is when price makes a new high (or low) but RSI does not.',
      depth: [
        'Regular divergence hints the move is tiring; hidden divergence hints the trend will carry on.',
        'Divergence can last a long time before price turns, so it is a warning, not an entry.',
        'Wait for structure to break the other way before acting on it.',
      ],
      desk: 'RSI(2) reversal was tested on Volatility 100 (1s). It made money on the period it was chosen on and lost on the unseen months (-13.8R).',
    },
    {
      id: 'liquidity-sweep',
      title: 'Liquidity sweep',
      simple: 'Price spikes just past an obvious high or low, triggers the stops resting there, then turns back.',
      depth: [
        'Stops cluster behind equal highs, equal lows and round numbers.',
        'A sweep is only confirmed once price closes back inside the range.',
        'Many sweeps are just breakouts that kept going, so the stop still matters.',
      ],
      desk: 'The Chart page marks sweeps. The potential-trade rule built on them lost after spread on every market tested.',
      link: { view: 'trades', label: 'Trades' },
    },
    {
      id: 'level-2',
      title: 'Level 2 (order book)',
      simple: 'The list of buy and sell orders waiting at each price, beyond the best bid and ask.',
      depth: [
        'It shows where size is waiting, but large orders can be pulled before price reaches them.',
        'It exists for stocks and futures traded on one exchange.',
        'Spot forex has no single exchange, so there is no full order book to read.',
      ],
      desk: 'Not available here. Deriv synthetics and spot forex do not publish an order book.',
    },
    {
      id: 'day-vs-swing',
      title: 'Day trading or swing trading',
      simple: 'Day trades open and close the same day. Swing trades are held for days or weeks.',
      depth: [
        'Shorter trades mean smaller targets, so the spread eats a bigger share of every win.',
        'Swing trades need wider stops and smaller positions, and they sit through overnight gaps.',
        'Pick the one that fits the hours you can actually watch a screen.',
      ],
      desk: 'The 3-year APA test made +40R before costs, but the spread took about 0.18R per trade and turned it into -362R over 2,265 trades. Only the slow gold trend held up.',
    },
    {
      id: 'stop-loss',
      title: 'Stop-loss',
      simple: 'The price where you admit the idea was wrong and get out. Set it before you enter.',
      depth: [
        'Put it past the level that proves you wrong, not a fixed number of pips.',
        'Never move it further away once you are in.',
        'Size the trade from the stop, not the other way round.',
      ],
      desk: 'The APA videos put the stop a few pips beyond the key level. The plan check above will not pass a plan without one.',
    },
    {
      id: 'position-size',
      title: 'Position size',
      simple: 'How big the trade is, worked out so that hitting the stop loses only the % of the account you chose.',
      depth: [
        'Lots = (balance × risk %) ÷ (stop distance × value of one price unit per lot).',
        'Round down to the broker\'s lot step, never up.',
        'Most traders keep risk at 1 to 2% per trade so a losing run cannot sink the account.',
      ],
      desk: 'The Position size page does this sum for every market on the Desk.',
      link: { view: 'calculator', label: 'Position size' },
    },
    {
      id: 'reward-risk',
      title: 'Reward to risk and win rate',
      simple: 'Reward to risk compares what you aim to make with what you can lose. The higher it is, the fewer wins you need.',
      depth: [
        'Break-even win rate = 1 ÷ (1 + reward to risk). At 1:3 you need to win 25% of the time.',
        'Costs push that line up, most on short trades with small targets.',
        'A high win rate with a small reward can still lose money.',
      ],
      desk: 'The APA test won 26.1% of trades at a 1:3 aim: just over break-even before costs, a loss after them.',
    },
  ];

  APA.mentorGuide = { LESSONS };
})((globalThis.APA = globalThis.APA || {}));
