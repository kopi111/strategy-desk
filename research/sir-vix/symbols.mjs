const s = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089');
s.onopen = () => s.send(JSON.stringify({ active_symbols: 'brief' }));
s.onerror = (e) => { console.error('ws error', e.message); process.exit(1); };
s.onclose = (e) => console.error('closed', e.code, e.reason);
s.onmessage = (m) => { const d = JSON.parse(m.data); if (d.error) { console.error(d.error); process.exit(1); }
  console.log('count', d.active_symbols.length);
  for (const x of d.active_symbols) if (/olatil|ump|tep/i.test(x.display_name)) console.log(x.symbol, '|', x.display_name);
  s.close(); };
