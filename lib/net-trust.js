'use strict';
// Client IP / HTTPS detection behind reverse proxies (cloudflared, nginx, Caddy, Cloudflare).
// Forwarding headers are honored ONLY when the TCP peer is a configured trusted proxy —
// otherwise any client could spoof its IP (rate-limit bypass) or claim HTTPS.

const net = require('net');

const DEFAULT_TRUSTED_PROXIES = '127.0.0.1/32,::1/128';

function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  const s = ip.trim();
  const m = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return m ? m[1] : s;
}

// "a.b.c.d", "a.b.c.d/n", "x::y", "x::y/n" → { address, prefix, type } | null
function parseCidr(entry) {
  const s = String(entry || '').trim();
  if (!s) return null;
  const slash = s.indexOf('/');
  const address = normalizeIp(slash === -1 ? s : s.slice(0, slash));
  const family = net.isIP(address);
  if (!family) return null;
  const max = family === 4 ? 32 : 128;
  let prefix = max;
  if (slash !== -1) {
    const p = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    if (prefix > max) return null;
  }
  return { address, prefix, type: family === 4 ? 'ipv4' : 'ipv6' };
}

// Returns a net.BlockList of trusted proxies, or null when nothing is trusted ('none').
// Invalid entries are reported via onInvalid and skipped (never widen trust on a typo).
function parseTrustedProxies(spec, onInvalid) {
  const raw = spec == null || String(spec).trim() === '' ? DEFAULT_TRUSTED_PROXIES : String(spec);
  if (raw.trim().toLowerCase() === 'none') return null;
  const list = new net.BlockList();
  let count = 0;
  for (const entry of raw.split(',')) {
    if (!entry.trim()) continue;
    const c = parseCidr(entry);
    if (!c) { if (onInvalid) onInvalid(entry.trim()); continue; }
    list.addSubnet(c.address, c.prefix, c.type);
    count++;
  }
  return count ? list : null;
}

function createNetTrust(spec, onInvalid) {
  const trusted = parseTrustedProxies(spec, onInvalid);

  function isTrustedProxy(ip) {
    if (!trusted) return false;
    const a = normalizeIp(ip);
    const family = net.isIP(a);
    if (!family) return false;
    return trusted.check(a, family === 4 ? 'ipv4' : 'ipv6');
  }

  function socketIp(req) {
    return normalizeIp(req?.socket?.remoteAddress || '');
  }

  function headerIp(value) {
    if (typeof value !== 'string') return null;
    const ip = normalizeIp(value);
    return net.isIP(ip) ? ip : null;
  }

  function clientIp(req) {
    const peer = socketIp(req);
    if (!isTrustedProxy(peer)) return peer;
    const h = req.headers || {};
    const cf = headerIp(h['cf-connecting-ip']);
    if (cf) return cf;
    const real = headerIp(h['x-real-ip']);
    if (real) return real;
    if (typeof h['x-forwarded-for'] === 'string') {
      const hops = h['x-forwarded-for'].split(',').map(normalizeIp);
      for (let i = hops.length - 1; i >= 0; i--) {
        if (!net.isIP(hops[i])) break; // malformed hop — stop rather than trust anything left of it
        if (!isTrustedProxy(hops[i])) return hops[i];
      }
    }
    return peer;
  }

  function isHttps(req) {
    if (req?.socket?.encrypted) return true;
    if (!isTrustedProxy(socketIp(req))) return false;
    const proto = req.headers?.['x-forwarded-proto'];
    return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https';
  }

  // Host the client actually addressed, as reported by a trusted proxy (lowercased, port kept).
  function forwardedHost(req) {
    if (!isTrustedProxy(socketIp(req))) return null;
    const v = req.headers?.['x-forwarded-host'];
    return typeof v === 'string' && v.trim() ? v.split(',')[0].trim().toLowerCase() : null;
  }

  function cookieFlags(req) {
    return `Path=/; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
  }

  return { isTrustedProxy, socketIp, clientIp, isHttps, forwardedHost, cookieFlags };
}

module.exports = { DEFAULT_TRUSTED_PROXIES, normalizeIp, parseCidr, parseTrustedProxies, createNetTrust };
