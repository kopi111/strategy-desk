const syms = process.argv.slice(2);
const s = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089');
let i = 0;
const next = () => { if (i >= syms.length) return s.close(); s.send(JSON.stringify({ ticks_history: syms[i], style: 'candles', granularity: 60, count: 2, end: 'latest' })); };
s.onopen = next;
s.onmessage = (m) => { const d = JSON.parse(m.data);
  console.log(syms[i], d.error ? 'ERR ' + d.error.message : 'ok close=' + d.candles.at(-1).close); i++; next(); };
