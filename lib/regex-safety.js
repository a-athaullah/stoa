// Regex safety utilities (R20): protect against ReDoS in user-supplied patterns.
// Three layers: fast heuristic reject, vm.runInContext with hard timeout, input cap.
const vm = require('vm');

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const DANGEROUS_RE = /(\+\??|\*\??|\{\d+,?\d*\})\)?(\+\??|\*\??|\{\d+,?\d*\})/;
const REGEX_TIMEOUT_MS = 50;

function runRegexInSandbox(pattern, input, timeoutMs) {
  const script = new vm.Script('result = new RegExp(pattern, "i").test(input)');
  const ctx = vm.createContext({ pattern, input, result: false });
  script.runInContext(ctx, { timeout: timeoutMs });
  return ctx.result;
}

function safeRegexTest(pattern, input) {
  if (typeof pattern !== 'string' || pattern.length > 200) return false;
  if (DANGEROUS_RE.test(pattern)) return false;
  try { new RegExp(pattern, 'i'); } catch { return false; }
  try {
    return runRegexInSandbox(pattern, (input || '').slice(0, 5000), REGEX_TIMEOUT_MS);
  } catch { return false; }
}

function validateRegexPattern(pattern) {
  if (typeof pattern !== 'string') return 'pattern must be a string';
  if (pattern.length > 200) return 'pattern must be 200 characters or less';
  if (DANGEROUS_RE.test(pattern)) return 'pattern contains nested quantifiers (potential ReDoS)';
  try { new RegExp(pattern, 'i'); } catch (e) { return `invalid regex: ${e.message}`; }
  try {
    runRegexInSandbox(pattern, 'a'.repeat(50), REGEX_TIMEOUT_MS);
  } catch { return 'pattern causes excessive backtracking (potential ReDoS)'; }
  return null;
}

module.exports = { escapeRegExp, safeRegexTest, validateRegexPattern };
