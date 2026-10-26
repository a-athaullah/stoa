'use strict';
// Avatar image checks, shared by the server (actor / sub-agent avatar uploads) and the agent client
// (stoa.js reads the file for stoa__sub_agent_avatar_set, so it is bundled into dist/stoa.js).
// The type comes from the magic bytes only: a data_url header or a file extension is the caller's
// claim, not proof. The agent side checks too, so a non-image file never leaves the agent machine.

const fs = require('fs');
const path = require('path');

const AVATAR_MAX_BYTES = 512 * 1024;
// JSON body of the upload route: base64 grows 4/3, plus the data_url header and JSON framing.
const AVATAR_BODY_MAX = Math.ceil(AVATAR_MAX_BYTES * 4 / 3) + 1024;
const TYPE_ERROR = 'unsupported image type (png, jpeg, webp or gif only)';
const SIZE_ERROR = `image too large (max ${AVATAR_MAX_BYTES / 1024} KB; resize to 256 px first)`;

const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// → { mime, ext } or null.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 6 && (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a')) return { mime: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

// → { buffer, ext } or { status, error }.
function checkAvatarImage(buf, maxBytes = AVATAR_MAX_BYTES) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { status: 400, error: 'empty image' };
  if (buf.length > maxBytes) return { status: 413, error: SIZE_ERROR };
  const type = sniffImage(buf);
  if (!type) return { status: 400, error: TYPE_ERROR };
  return { buffer: buf, ext: type.ext };
}

// data:image/<any>;base64,<payload> → { buffer, ext } or { status, error }. Strict base64, so a
// payload Buffer.from would silently truncate is refused instead of saved half-decoded.
function decodeAvatarDataUrl(dataUrl, maxBytes = AVATAR_MAX_BYTES) {
  const head = typeof dataUrl === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.exec(dataUrl);
  if (!head) return { status: 400, error: 'invalid data_url' };
  const b64 = dataUrl.slice(head[0].length);
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { status: 400, error: 'invalid base64 in data_url' };
  if (b64.length / 4 * 3 - (b64.match(/=*$/)[0].length) > maxBytes) return { status: 413, error: SIZE_ERROR };
  return checkAvatarImage(Buffer.from(b64, 'base64'), maxBytes);
}

// Agent side: read an image file by absolute path. Size is checked before the file is read.
// → { base64 } or { error, status }.
function readAvatarFile(filePath, maxBytes = AVATAR_MAX_BYTES) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { status: 400, error: 'path must be absolute' };
  let st;
  try { st = fs.statSync(filePath); } catch (e) { return { status: 400, error: e.code === 'ENOENT' ? 'file not found' : `cannot read file (${e.code || 'error'})` }; }
  if (!st.isFile()) return { status: 400, error: 'not a regular file' };
  if (st.size > maxBytes) return { status: 413, error: SIZE_ERROR };
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (e) { return { status: 400, error: `cannot read file (${e.code || 'error'})` }; }
  const img = checkAvatarImage(buf, maxBytes);
  return img.error ? img : { base64: img.buffer.toString('base64') };
}

module.exports = { AVATAR_MAX_BYTES, AVATAR_BODY_MAX, sniffImage, checkAvatarImage, decodeAvatarDataUrl, readAvatarFile };
