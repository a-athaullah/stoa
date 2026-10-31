'use strict';
// [send:<path>] markers: how an agent attaches a file of its machine to a message. Parsed by the
// agent client (stoa.js: final answers, unsolicited turns) and by the server (stoa__message_send),
// which then asks that agent client to upload the paths. A marker inside inline code or a fenced
// code block is text — an agent explaining the syntax must not trigger an upload.

const { splitCodeSpans } = require('./code-spans');

const MARKER_RE = /\[send:([^\]]+)\]/g;

// → { text: content without the markers (trimmed), paths: marker paths in order }
function extractSendMarkers(content) {
  const s = typeof content === 'string' ? content : '';
  if (!s.includes('[send:')) return { text: s, paths: [] };
  const paths = [];
  const text = splitCodeSpans(s).map((seg) => (seg.code ? seg.text : seg.text.replace(MARKER_RE, (_, p) => {
    paths.push(p.trim());
    return '';
  }))).join('');
  return paths.length ? { text: text.trim(), paths } : { text: s, paths };
}

// failures: [{ name, reason }] → the "⚠️ file … gagal dikirim" lines appended to the message.
function failureNotes(failures) {
  return (failures || []).map((f) => `⚠️ file ${f.name} gagal dikirim: ${f.reason}`);
}

module.exports = { extractSendMarkers, failureNotes };
