'use strict';
// gzip for JSON API responses. Room feeds and lists run to hundreds of KB of repetitive JSON; over a
// tunnel (Tailscale, Cloudflare) the transfer, not the query, is what a room switch waits on.
// Small bodies go out as they are: below MIN_BYTES the gzip header and CPU cost more than they save.

const zlib = require('zlib');

const MIN_BYTES = 1024;

// True when the request's Accept-Encoding allows gzip: a `gzip` token, or `*` when
// gzip is not listed on its own, with q > 0. "gzip;q=0" is an explicit refusal.
function acceptsGzip(header) {
  if (typeof header !== 'string' || !header) return false;
  let star = null;
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    const name = token.trim();
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    const allowed = Number.isFinite(q) && q > 0;
    if (name === 'gzip') return allowed;
    if (name === '*') star = allowed;
  }
  return star === true;
}

// Writes a JSON body, gzipped when the client accepts it and the body is large enough.
// Falls back to the plain body if compression fails, so a zlib error can never turn a good
// response into a 500. Compression runs off the event loop (zlib thread pool).
function sendJson(req, res, status, body) {
  const buf = Buffer.from(body ?? '', 'utf8');
  const base = { 'Content-Type': 'application/json', Vary: 'Accept-Encoding' };
  if (buf.length < MIN_BYTES || !acceptsGzip(req?.headers?.['accept-encoding'])) {
    res.writeHead(status, { ...base, 'Content-Length': buf.length });
    return res.end(buf);
  }
  zlib.gzip(buf, (err, out) => {
    // The response may have been answered (error handler) or dropped (client gone) meanwhile.
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    if (err) {
      res.writeHead(status, { ...base, 'Content-Length': buf.length });
      return res.end(buf);
    }
    res.writeHead(status, { ...base, 'Content-Encoding': 'gzip', 'Content-Length': out.length });
    res.end(out);
  });
}

module.exports = { acceptsGzip, sendJson };
