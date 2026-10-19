'use strict';
// Cloudflare Access service token for agents that reach Stoa through a Cloudflare-protected
// domain (no Tailscale). The token is attached ONLY to requests for the Stoa origin, never to
// other hosts (model providers, attachment mirrors, ...). Child sessions (Claude/Codex) curl
// $STOA_URL themselves, so they talk to a loopback forward proxy that injects the headers —
// the token never enters their environment or prompt.

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const ID_HEADER = 'CF-Access-Client-Id';
const SECRET_HEADER = 'CF-Access-Client-Secret';
const PROXY_MAX_BODY = 25 * 1024 * 1024;     // same cap as POST /api/upload/raw
const PROXY_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // long LLM streams via /v1/messages stay idle-but-open
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'upgrade', 'host']);

// → { clientId, clientSecret } when both are set, else null (one without the other is a config error).
function readCfAccessEnv(env, warn) {
  const clientId = String(env?.STOA_CF_ACCESS_CLIENT_ID || '').trim();
  const clientSecret = String(env?.STOA_CF_ACCESS_CLIENT_SECRET || '').trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  if ((clientId || clientSecret) && warn) warn('[stoa] STOA_CF_ACCESS_CLIENT_ID and STOA_CF_ACCESS_CLIENT_SECRET must both be set — ignoring Cloudflare Access token');
  return null;
}

// ws:/wss: map to http:/https: so the WebSocket URL and HTTP URLs share one origin.
function httpOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'ws:') u.protocol = 'http:';
    else if (u.protocol === 'wss:') u.protocol = 'https:';
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
}

function cfHeadersFor(targetUrl, stoaUrl, creds) {
  if (!creds) return {};
  const target = httpOrigin(targetUrl);
  if (!target || target !== httpOrigin(stoaUrl)) return {};
  return { [ID_HEADER]: creds.clientId, [SECRET_HEADER]: creds.clientSecret };
}

// Loopback forward proxy: http://127.0.0.1:<port>/<prefix>/<path> → <stoa origin>/<path> + CF headers.
// The random path prefix means only processes handed the URL (child sessions via env) can use it.
// getUpstream() is read per request so a server-announced URL change is followed.
function startCfForwardProxy({ getUpstream, creds, maxBodyBytes = PROXY_MAX_BODY, idleTimeoutMs = PROXY_IDLE_TIMEOUT_MS, log = () => {} }) {
  const prefix = '/' + crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const fail = (status, msg) => {
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(msg);
    };
    // Origin-form only, under our prefix: no absolute-form, no open proxying.
    if (typeof req.url !== 'string' || !req.url.startsWith(prefix + '/')) return fail(404, 'not found');
    const upstream = httpOrigin(getUpstream());
    if (!upstream) return fail(502, 'stoa upstream not configured');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBodyBytes) return fail(413, 'payload too large');
    const target = new URL(req.url.slice(prefix.length), upstream);
    if (target.origin !== upstream) return fail(400, 'bad request');

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk) || lk === ID_HEADER.toLowerCase() || lk === SECRET_HEADER.toLowerCase()) continue;
      headers[k] = v;
    }
    headers[ID_HEADER] = creds.clientId;
    headers[SECRET_HEADER] = creds.clientSecret;

    const lib = target.protocol === 'https:' ? https : http;
    const up = lib.request(target, { method: req.method, headers }, (upRes) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
    });
    up.setTimeout(idleTimeoutMs, () => up.destroy(new Error('upstream idle timeout')));
    up.on('error', (e) => { log(`[stoa:cf-proxy] upstream error: ${e.message}`); fail(502, 'upstream error'); });
    res.on('close', () => { if (!up.destroyed && !res.writableFinished) up.destroy(); });

    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        up.destroy();
        fail(413, 'payload too large');
        req.destroy();
        return;
      }
      if (!up.write(chunk)) { req.pause(); up.once('drain', () => req.resume()); }
    });
    req.on('end', () => up.end());
    req.on('error', () => up.destroy());
  });
  // CONNECT tunnels and WebSocket upgrades are refused (children only make plain HTTP calls).
  server.on('connect', (_req, socket) => { socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); });
  server.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 501 Not Implemented\r\n\r\n'); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `127.0.0.1:${port}${prefix}`;
      resolve({ port, prefix, httpUrl: `http://${base}`, wsUrl: `ws://${base}`, close: () => new Promise(r => server.close(() => r())), server });
    });
  });
}

module.exports = { ID_HEADER, SECRET_HEADER, readCfAccessEnv, httpOrigin, cfHeadersFor, startCfForwardProxy };
