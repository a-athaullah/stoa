// Regex safety utilities (R20): protect against ReDoS in user-supplied patterns.
// Two layers: fast heuristic reject + timing probe on short input prefix.

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const DANGEROUS_RE = /(\+\??|\*\??|\{\d+,?\d*\})\)?(\+\??|\*\??|\{\d+,?\d*\})/;

function safeRegexTest(pattern, input) {
  if (typeof pattern !== 'string' || pattern.length > 200) return false;
  if (DANGEROUS_RE.test(pattern)) return false;
  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return false; }
  const probe = (typeof input === 'string' ? input : '').slice(0, 20);
  const t0 = process.hrtime.bigint();
  re.test(probe);
  if (Number(process.hrtime.bigint() - t0) > 10_000_000) return false;
  return re.test(input);
}

function validateRegexPattern(pattern) {
  if (typeof pattern !== 'string') return 'pattern must be a string';
  if (pattern.length > 200) return 'pattern must be 200 characters or less';
  if (DANGEROUS_RE.test(pattern)) return 'pattern contains nested quantifiers (potential ReDoS)';
  try { new RegExp(pattern, 'i'); } catch (e) { return `invalid regex: ${e.message}`; }
  return null;
}

module.exports = { escapeRegExp, safeRegexTest, validateRegexPattern, DANGEROUS_RE };
