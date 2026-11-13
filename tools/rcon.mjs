// Sends one command to the remote console of a server.
// Usage: RCON_PASSWORD=<password> node tools/rcon.mjs <ws://host:port> <command>
// Example: RCON_PASSWORD=my-secret-words node tools/rcon.mjs ws://localhost:27960 bots 6 2
const [url, ...words] = process.argv.slice(2);
const pw = process.env.RCON_PASSWORD;
if (!url || !words.length || !pw) {
  console.error('Usage: RCON_PASSWORD=<password> node tools/rcon.mjs <ws://host:port> <command>');
  process.exit(1);
}
const ws = new WebSocket(url);
let timer;
const done = (code) => { clearTimeout(timer); ws.close(); process.exitCode = code; };
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'rcon', pw, cmd: words.join(' ') }));
  timer = setTimeout(() => done(0), 3000);
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t !== 'print') return;
  console.log(m.text);
  // The answer is complete when no more lines arrive for a short time.
  clearTimeout(timer);
  timer = setTimeout(() => done(0), 300);
};
ws.onerror = () => { console.error(`Could not connect to ${url}.`); done(1); };
