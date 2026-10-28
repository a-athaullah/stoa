'use strict';

const { escapeRegExp } = require('./regex-safety');

// Which of `names` are @mentioned in `text`, mapped to the index of their first mention.
// Names can be several words and one can prefix another ("Kira" / "Kira Dev"), so the longest
// names match first and each matched span is consumed: "@Kira Dev" never also mentions "Kira".
// A mention starts after a non-word character and ends before one ("@Kirana" is not "@Kira").
// Case-sensitive, like the names shown in the room.
function findMentions(text, names) {
  const found = new Map();
  if (typeof text !== 'string' || !text.includes('@')) return found;
  const taken = [];
  const unique = [...new Set(names.filter(n => typeof n === 'string' && n))].sort((a, b) => b.length - a.length);
  for (const name of unique) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_@])@${escapeRegExp(name)}(?![\\p{L}\\p{N}_-])`, 'gu');
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      if (!found.has(name)) found.set(name, start);
    }
  }
  return found;
}

module.exports = { findMentions };
