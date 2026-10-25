'use strict';

// Server-side WebSocket heartbeat. A peer that vanished without a FIN (machine asleep,
// Wi-Fi/VPN drop) leaves a half-open socket the OS only notices after its TCP timeout
// (minutes to hours); until then the disconnect cleanup never runs. Each tick pings every
// socket; one that sent no bytes at all since the previous tick is terminated, which fires its
// normal 'close' handler. Browsers and ws clients auto-pong. Any inbound byte counts, not just
// pong/message: a large frame (proxy_file_read base64) on a slow link queues the pong behind it.

const DEFAULT_WS_HEARTBEAT_MS = 30_000;
const MIN_WS_HEARTBEAT_MS = 1_000;
const MAX_WS_HEARTBEAT_MS = 300_000;

// STOA_WS_HEARTBEAT_MS → interval ms; null when set but not an integer within bounds.
function parseHeartbeatMs(raw) {
  if (raw === undefined || raw === '') return DEFAULT_WS_HEARTBEAT_MS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_WS_HEARTBEAT_MS && n <= MAX_WS_HEARTBEAT_MS ? n : null;
}

function startWsHeartbeat(wss, intervalMs, onTimeout) {
  const alive = new WeakMap();
  wss.on('connection', (ws, req) => {
    alive.set(ws, true);
    req.socket.on('data', () => alive.set(ws, true));
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        try { onTimeout?.(ws); } catch (e) { console.error('[ws] heartbeat onTimeout error:', e.message); }
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping(); // wss.clients holds only handshaken sockets; ping() throws only while CONNECTING
    }
  }, intervalMs);
  wss.on('close', () => clearInterval(timer));
  return timer;
}

module.exports = { parseHeartbeatMs, startWsHeartbeat, DEFAULT_WS_HEARTBEAT_MS, MIN_WS_HEARTBEAT_MS, MAX_WS_HEARTBEAT_MS };
