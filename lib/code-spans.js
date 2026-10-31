'use strict';
// Markdown code (fenced blocks and inline spans) is an example, not an instruction: a
// mention inside it does not trigger (server.js) and a [send:] marker inside it is not
// uploaded (lib/send-markers.js). Shared by the server and the agent client (stoa.js).
//
// Unclosed fences/backticks match nothing, so the rest of the message still counts.
// Both passes are linear scanners on purpose: this runs on the event loop for every
// human, agent and proactive message, and the regex version backtracked quadratically
// on unclosed fences/backtick runs (100k unclosed fence lines froze the server ~50 s).

// → [{ code: boolean, text }] — concatenating every text gives back the content.
function splitCodeSpans(content) {
  if (!content) return [];
  if (!content.includes('`') && !content.includes('~~~')) return [{ code: false, text: content }];

  const segs = [];
  const push = (code, text) => {
    if (!text) return;
    const last = segs[segs.length - 1];
    if (last && last.code === code && !code) last.text += text;
    else segs.push({ code, text });
  };

  // Fences: an opener line (run of ≥3 ` or ~, any info string) closes at the next line
  // that is only a run of the same char with length ≥ the opener's. sufMax[c][i] = the
  // longest closer of char c at or after line i, so an opener without a closer is
  // rejected in O(1) and scanning resumes on the next line; a successful scan consumes
  // the lines it walked, keeping the whole pass O(n).
  const lines = content.split('\n');
  const n = lines.length;
  const closer = new Array(n);
  const sufMax = { '`': new Int32Array(n + 1), '~': new Int32Array(n + 1) };
  for (let i = n - 1; i >= 0; i--) {
    const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
    closer[i] = m ? { c: m[1][0], len: m[1].length } : null;
    sufMax['`'][i] = sufMax['`'][i + 1];
    sufMax['~'][i] = sufMax['~'][i + 1];
    if (m) sufMax[m[1][0]][i] = Math.max(sufMax[m[1][0]][i], m[1].length);
  }
  for (let i = 0; i < n; i++) {
    if (i > 0) push(false, '\n');
    const open = /^[ \t]*(`{3,}|~{3,})/.exec(lines[i]);
    if (open) {
      const c = open[1][0], len = open[1].length;
      if (sufMax[c][i + 1] >= len) {
        let j = i + 1;
        while (!(closer[j] && closer[j].c === c && closer[j].len >= len)) j++;
        push(true, lines.slice(i, j + 1).join('\n'));
        i = j;
        continue;
      }
    }
    splitInline(lines[i], push);
  }
  return segs;
}

// Inline spans, per line: an opener is any suffix of a backtick run (leftmost start
// wins, so the longest suffix first) and closes at the nearest later run of exactly
// that length on the same line. Per-length pointers only move forward and each run
// tries at most its own length, so the pass stays O(line length).
function splitInline(line, push) {
  if (!line.includes('`')) { push(false, line); return; }
  const runs = [];
  for (let k = 0; k < line.length;) {
    if (line[k] !== '`') { k++; continue; }
    let e = k;
    while (line[e] === '`') e++;
    runs.push([k, e - k]);
    k = e;
  }
  const byLen = new Map();
  runs.forEach(([, len], idx) => {
    if (!byLen.has(len)) byLen.set(len, { list: [], ptr: 0 });
    byLen.get(len).list.push(idx);
  });
  const nextRunOfLen = (len, after) => {
    const e = byLen.get(len);
    if (!e) return -1;
    while (e.ptr < e.list.length && e.list[e.ptr] <= after) e.ptr++;
    return e.ptr < e.list.length ? e.list[e.ptr] : -1;
  };
  let pos = 0;
  for (let r = 0; r < runs.length; r++) {
    const [start, len] = runs[r];
    for (let m = len; m >= 1; m--) {
      const close = nextRunOfLen(m, r);
      if (close === -1) continue;
      push(false, line.slice(pos, start + len - m));
      pos = runs[close][0] + m;
      push(true, line.slice(start + len - m, pos));
      r = close;
      break;
    }
  }
  push(false, line.slice(pos));
}

// Content with every code span/block replaced by one space, so the text around it can't
// fuse into a new mention. For trigger detection only — stored content is untouched.
function stripCodeSpans(content) {
  return splitCodeSpans(content).map((s) => (s.code ? ' ' : s.text)).join('');
}

module.exports = { splitCodeSpans, stripCodeSpans };
