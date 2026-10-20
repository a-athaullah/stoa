'use strict';
// Turns free-form user search input into FTS5 MATCH expressions that can never raise a syntax
// error. Raw input used to go straight into MATCH, so `tidak ada-apa` became the column filter
// `apa` ("no such column") and `"`, `:`, `(`, `*` broke the parser — the UI showed "Search failed".
//
// Every term is emitted as a double-quoted FTS5 string, which FTS5 treats as plain text run
// through the tokenizer: operators (AND/OR/NOT/NEAR), column filters and `^` lose their meaning.
// Terms are split on the same boundaries as the default unicode61 tokenizer (letters/numbers),
// so quoting changes nothing about what matches.

const MAX_INPUT = 500;
const MAX_TERMS = 16;
const MAX_TERM_LEN = 64;
// A term whose last word is shorter is matched exactly: a 1-2 char prefix expands to a large
// slice of the index and mostly adds noise.
const MIN_PREFIX_LEN = 3;

const WORD_RE = /[\p{L}\p{N}]+/gu;

function words(s) {
  return (s.match(WORD_RE) || []).map(w => w.slice(0, MAX_TERM_LEN).toLowerCase());
}

// Returns a list of terms; a term is { words: [...], exact: bool }. Text inside balanced double
// quotes is kept together as an exact phrase; an unbalanced quote is ignored. Outside quotes each
// whitespace-separated chunk is one term, so `stoa-agent` / `server.js` search for the adjacent
// words rather than two unrelated ones.
function parseSearchTerms(input) {
  const s = String(input ?? '').slice(0, MAX_INPUT);
  const terms = [];
  const seen = new Set();
  const add = (ws, exact) => {
    if (!ws.length) return;
    const key = (exact ? 'e:' : 'w:') + ws.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ words: ws, exact });
  };
  const addLoose = text => { for (const chunk of text.split(/\s+/)) add(words(chunk), false); };
  const re = /"([^"]*)"/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    addLoose(s.slice(last, m.index));
    add(words(m[1]), true);
    last = re.lastIndex;
  }
  addLoose(s.slice(last));
  return terms.slice(0, MAX_TERMS);
}

function termToFts(t) {
  const body = '"' + t.words.join(' ') + '"';
  return !t.exact && t.words[t.words.length - 1].length >= MIN_PREFIX_LEN ? body + '*' : body;
}

// { and, or } MATCH strings, or null when the input has no searchable characters.
// `or` is the fallback: every loose word on its own (user-quoted phrases stay intact), so
// `stoa-agent` still finds "stoa" or "agent" when the adjacent pair never occurs. It is null when
// it would be identical to `and`.
function buildFtsQueries(input) {
  const terms = parseSearchTerms(input);
  if (!terms.length) return null;
  const and = terms.map(termToFts).join(' AND ');
  const seen = new Set();
  const loose = [];
  for (const t of terms) {
    const split = t.exact ? [t] : t.words.map(w => ({ words: [w], exact: false }));
    for (const u of split) {
      const f = termToFts(u);
      if (!seen.has(f)) { seen.add(f); loose.push(f); }
    }
  }
  const or = loose.join(' OR ');
  return { and, or: loose.length > 1 && or !== and ? or : null };
}

// FTS5 snippet() prefers fragments that start at a sentence, so in a long message the first
// <mark> can sit 150+ characters in — past the two lines the result list clamps to, which looks
// like a hit with nothing highlighted. Start the snippet a little before the first mark instead.
const SNIPPET_LEAD = 50;
function focusSnippet(snippet, lead = SNIPPET_LEAD) {
  if (typeof snippet !== 'string') return snippet;
  const at = snippet.indexOf('<mark>');
  if (at <= lead) return snippet;
  const space = snippet.indexOf(' ', at - lead);
  const cut = space >= 0 && space < at ? space + 1 : at;
  return '…' + snippet.slice(cut);
}

// Reciprocal Rank Fusion (Cormack et al., k=60): score = Σ 1/(k + rank) over the lists an id
// appears in. Rank-based, so the keyword (bm25) and cosine scales never have to be compared.
// Returns [{ id, keyword, semantic }] best first; ties keep keyword order.
const RRF_K = 60;
function fuseRrf(keywordIds, semanticIds, k = RRF_K) {
  const acc = new Map();
  const add = (ids, key) => ids.forEach((id, rank) => {
    const e = acc.get(id) || { id, score: 0, order: acc.size, keyword: false, semantic: false };
    e.score += 1 / (k + rank + 1);
    e[key] = true;
    acc.set(id, e);
  });
  add(keywordIds, 'keyword');
  add(semanticIds, 'semantic');
  return [...acc.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ id, keyword, semantic }) => ({ id, keyword, semantic }));
}

module.exports = { parseSearchTerms, buildFtsQueries, focusSnippet, fuseRrf, MAX_TERMS, MAX_TERM_LEN };
