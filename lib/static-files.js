'use strict';
// Static files from public/. Every response carries an ETag so the browser can revalidate
// (Cache-Control stays `no-cache` for app code: a client update shows on the next reload) and an
// unchanged file costs a 304 instead of the full body. Bodies sit in memory keyed by path and
// invalidated by size+mtime (one stat per request); gzip runs once per file version, not per request.

const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { acceptsGzip } = require('./http-compress');

const MIN_GZIP_BYTES = 1024;

// If-None-Match uses weak comparison (RFC 9110 13.1.2): W/ prefixes are ignored, `*` matches any.
function etagMatches(header, etag) {
  if (typeof header !== 'string' || !header) return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some(t => {
    const v = t.trim();
    return v === '*' || v.replace(/^W\//, '') === bare;
  });
}

// maxBytes bounds the whole cache (bodies + their gzip), evicting least recently used.
// Files above maxFileBytes are streamed and never cached.
function createStaticFiles({ maxBytes = 32 * 1024 * 1024, maxFileBytes = 2 * 1024 * 1024 } = {}) {
  const cache = new Map();
  let total = 0;

  function drop(key) {
    const e = cache.get(key);
    if (!e) return;
    total -= e.bytes;
    cache.delete(key);
  }

  // Bytes count only while the entry is still the cached one: a load that finishes after its
  // file changed (entry replaced) must not inflate the total.
  function account(key, e, n) {
    if (cache.get(key) !== e) return;
    e.bytes += n;
    total += n;
    for (const k of cache.keys()) {
      if (total <= maxBytes) break;
      if (k !== key) drop(k);
    }
  }

  function entryFor(absPath, st, transform) {
    const version = `${st.size}:${st.mtimeMs}`;
    let e = cache.get(absPath);
    if (e && e.version === version) {
      cache.delete(absPath);
      cache.set(absPath, e);
      return e;
    }
    drop(absPath);
    e = { version, bytes: 0, gz: null };
    // ETag from the content hash, not mtime: a transform (index.html → bundle tags) can change the
    // body across restarts while the file on disk stays the same.
    e.load = fs.promises.readFile(absPath).then(buf => {
      const body = transform ? Buffer.from(transform(buf)) : buf;
      const etag = `W/"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
      account(absPath, e, body.length);
      return { body, etag };
    });
    e.load.catch(() => { if (cache.get(absPath) === e) drop(absPath); });
    cache.set(absPath, e);
    return e;
  }

  // Resolves to the gzipped body, or null when gzip fails or does not shrink it (plain body sent).
  function gzipFor(absPath, e, body) {
    if (!e.gz) {
      e.gz = new Promise(resolve => zlib.gzip(body, { level: zlib.constants.Z_BEST_COMPRESSION }, (err, out) => {
        resolve(err || out.length >= body.length ? null : out);
      }));
      e.gz.then(out => { if (out) account(absPath, e, out.length); });
    }
    return e.gz;
  }

  function streamLarge(req, res, absPath, st, headers) {
    headers.ETag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (etagMatches(req.headers['if-none-match'], headers.ETag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    const src = fs.createReadStream(absPath);
    if (acceptsGzip(req.headers['accept-encoding'])) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      return pipeline(src, zlib.createGzip(), res, () => {});
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    pipeline(src, res, () => {});
  }

  // Returns false (nothing written) when absPath is not a regular file, so the caller can fall
  // through to its other routes. `transform(buf)` rewrites the body once per file version.
  async function serve(req, res, absPath, { type, cacheControl, transform } = {}) {
    const st = await fs.promises.stat(absPath).catch(() => null);
    if (!st?.isFile()) return false;
    const headers = { 'Cache-Control': cacheControl, Vary: 'Accept-Encoding' };
    if (st.size > maxFileBytes && !transform) {
      streamLarge(req, res, absPath, st, { ...headers, 'Content-Type': type });
      return true;
    }
    const e = entryFor(absPath, st, transform);
    let loaded;
    try {
      loaded = await e.load;
    } catch (err) {
      // Deleted or replaced by a directory between stat and read.
      if (err.code === 'ENOENT' || err.code === 'EISDIR') return false;
      throw err;
    }
    headers.ETag = loaded.etag;
    if (etagMatches(req.headers['if-none-match'], loaded.etag)) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    let out = loaded.body;
    if (out.length >= MIN_GZIP_BYTES && acceptsGzip(req.headers['accept-encoding'])) {
      const gz = await gzipFor(absPath, e, out);
      if (gz) {
        out = gz;
        headers['Content-Encoding'] = 'gzip';
      }
    }
    // The client may have gone away while the body was read or compressed.
    if (res.headersSent || res.destroyed) return true;
    res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': out.length });
    res.end(out);
    return true;
  }

  return { serve, stats: () => ({ entries: cache.size, bytes: total }) };
}

module.exports = { createStaticFiles, etagMatches };
