'use strict';
// Knowledge documents (3/6): the file checks shared by the agent client (stoa.js reads the file for
// stoa__knowledge_add, so this module is bundled into dist/stoa.js) and the server
// (lib/knowledge-documents.js checks the text again: a connector may be old, broken or forged).
// Only plain text leaves the agent machine: a regular file with an allowed extension, at most
// KNOWLEDGE_DOC_MAX_BYTES (checked from stat, before the file is read), strict UTF-8, no NUL.

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DOC_MAX_BYTES = 512 * 1024;
const KNOWLEDGE_DOC_EXTS = ['.md', '.markdown', '.txt'];
const NAME_MAX = 200;

const allowedExt = (name) => KNOWLEDGE_DOC_EXTS.includes(path.extname(String(name)).toLowerCase());
const EXT_ERROR = `only ${KNOWLEDGE_DOC_EXTS.join(', ')} files can be added`;
const SIZE_ERROR = `file is larger than ${KNOWLEDGE_DOC_MAX_BYTES / 1024} KB`;

// Document name (identity in the room): 1..NAME_MAX chars, no path separator or control
// character, an allowed extension. → error text or null.
function nameError(name) {
  if (typeof name !== 'string' || !name.trim()) return 'name required';
  if (name !== name.trim()) return 'name must not start or end with spaces';
  if (name.length > NAME_MAX) return `name longer than ${NAME_MAX} characters`;
  if (/[\\/\u0000-\u001f\u007f]/.test(name)) return 'name must not contain / \\ or control characters';
  if (!allowedExt(name)) return EXT_ERROR;
  return null;
}

// Decoded text of a document's bytes. → { text } or { error }.
function decodeKnowledgeText(buf) {
  if (buf.length > KNOWLEDGE_DOC_MAX_BYTES) return { error: SIZE_ERROR };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return { error: 'file is not valid UTF-8 text' }; }
  if (text.includes('\u0000')) return { error: 'file is not text (NUL byte)' };
  return { text };
}

// Agent side: resolvedPath is absolute (relative paths are resolved against the session workdir by
// the caller). stat follows symlinks, so a link to a directory or device is refused like one.
// → { name, content } or { error }.
function readKnowledgeFile(resolvedPath, { readFile = fs.readFileSync } = {}) {
  if (typeof resolvedPath !== 'string' || !path.isAbsolute(resolvedPath)) return { error: 'path must be absolute' };
  const name = path.basename(resolvedPath);
  if (!allowedExt(name)) return { error: EXT_ERROR };
  let st;
  try { st = fs.statSync(resolvedPath); } catch (e) { return { error: e.code === 'ENOENT' ? 'file not found' : `cannot read file (${e.code || 'error'})` }; }
  if (!st.isFile()) return { error: 'not a regular file' };
  if (st.size > KNOWLEDGE_DOC_MAX_BYTES) return { error: SIZE_ERROR };
  let buf;
  try { buf = readFile(resolvedPath); } catch (e) { return { error: `cannot read file (${e.code || 'error'})` }; }
  const r = decodeKnowledgeText(buf);
  return r.error ? r : { name, content: r.text };
}

module.exports = { KNOWLEDGE_DOC_MAX_BYTES, KNOWLEDGE_DOC_EXTS, NAME_MAX, allowedExt, nameError, decodeKnowledgeText, readKnowledgeFile, EXT_ERROR, SIZE_ERROR };
