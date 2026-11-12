// Connections to a game host. A remote host uses WebSocket.
// A local host runs in the browser for the offline mode.
import { GameHost } from '../../shared/host.js';

export function connectRemote(url, handlers) {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.open();
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handlers.message(m);
  };
  ws.onclose = () => handlers.close();
  return {
    local: false,
    send(m) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close() { ws.onclose = null; ws.close(); },
  };
}

export function connectLocal(opts, handlers) {
  const host = new GameHost(opts);
  const handle = host.connect({ send: (m) => handlers.message(m), close() {} });
  return {
    local: true,
    host,
    send(m) { handle.message(m); },
    step() { host.step(); },
    close() { handle.close(); },
  };
}
