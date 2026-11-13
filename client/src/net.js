// Connections to a game host. A remote host uses WebSocket.
// A local host runs in the browser for the offline mode.
import { GameHost } from '../../shared/host.js';
import { encodeCmds, decodeSnapshot } from '../../shared/codec.js';

export function connectRemote(url, handlers) {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => handlers.open();
  ws.onmessage = (e) => {
    // Binary data is a snapshot. Text is a JSON message.
    let m;
    try { m = typeof e.data === 'string' ? JSON.parse(e.data) : decodeSnapshot(e.data); } catch { return; }
    if (m) handlers.message(m);
  };
  ws.onclose = () => handlers.close();
  return {
    local: false,
    send(m) {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Input commands go as binary data.
      ws.send(m.t === 'c' ? encodeCmds(m.c) : JSON.stringify(m));
    },
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
