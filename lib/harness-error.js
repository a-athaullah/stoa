'use strict';

// Harness failure detail shown in chat instead of "(agent returned an empty reply)" (task #30).
// stoa.js builds it from the CLI's stderr before sending agent_complete / agent_error; server.js
// validates and redacts it again (defense in depth: an older or tampered agent may send anything).
// claude-session.js / codex-session.js ship as separate update files and must not require lib/:
// they only hand over the raw stderr tail, all redaction happens here.

const STDERR_TAIL_MAX_LINES = 20;
const STDERR_TAIL_MAX_CHARS = 2048;
// Raw stderr kept per run before redaction; bounds the regex work on a chatty CLI.
const STDERR_RAW_KEEP = 16384;
const SUMMARY_LINE_MAX = 200;
const HARNESS_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const SIGNAL_RE = /^SIG[A-Z0-9]{1,12}$/;

// Bounded quantifiers keep every pattern linear-ish on hostile input (no catastrophic backtracking).
const SECRET_KEY = '[A-Za-z0-9_.-]{0,40}(?:api[_-]?key|apikey|access[_-]?key|secret|token|password|passwd|pwd|credential|signature|private[_-]?key)[A-Za-z0-9_.-]{0,40}';

// Order matters: whole-line header values first, then key/value pairs, then bare token shapes.
const REDACTIONS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]'],
  [/\b((?:proxy-)?authorization|x-api-key|api-key|x-goog-api-key|x-auth-token|cookie|set-cookie)(["']?\s*[:=]\s*)[^\n]*/gi, '$1$2[redacted]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
  [new RegExp(`(${SECRET_KEY}\\s*=\\s*["']?)[^\\s&"';,)]+`, 'gi'), '$1[redacted]'],
  [/([?&;](?:sig|se|sp|st|auth|key|code)=)[^\s&"']+/gi, '$1[redacted]'],
  [/(\bsig=)[^\s&"']+/gi, '$1[redacted]'],
  // "key": "value" / key: value — only values that look generated (8+ chars with a digit), so
  // prose such as "invalid token: expired" keeps its meaning.
  [new RegExp(`(["']?${SECRET_KEY}["']?\\s*:\\s*["']?)(?=[^\\s"',}]{0,256}\\d)[^\\s"',}]{8,}`, 'gi'), '$1[redacted]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\b(?:sk|ghp|gho|ghs|ghu|ghr|xox[abposr]|github_pat|glpat)[-_][A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  // Long opaque strings mixing letters and digits (raw keys, hex secrets).
  [/\b(?=[A-Za-z0-9_-]{0,256}\d)(?=[A-Za-z0-9_-]{0,256}[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, '[redacted]'],
];

// CLI output for the UI: ANSI/control characters stripped (newlines kept), home directory and
// absolute user paths masked as "~", secret-looking values replaced by "[redacted]". Idempotent.
function redactSecrets(text, home) {
  if (typeof text !== 'string') return '';
  let s = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');
  if (typeof home === 'string' && home.length > 1) s = s.split(home).join('~');
  s = s.replace(/(?:\/Users|\/home)\/[^\s/'"]+/g, '~').replace(/[A-Za-z]:\\Users\\[^\s\\'"]+/gi, '~');
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s;
}

// Last STDERR_TAIL_MAX_LINES non-empty lines, at most STDERR_TAIL_MAX_CHARS (tail kept).
function stderrTail(raw, home) {
  if (typeof raw !== 'string' || !raw) return '';
  const lines = redactSecrets(raw.slice(-STDERR_RAW_KEEP), home)
    .split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  let s = lines.slice(-STDERR_TAIL_MAX_LINES).join('\n');
  if (s.length > STDERR_TAIL_MAX_CHARS) s = '…' + s.slice(-(STDERR_TAIL_MAX_CHARS - 1));
  return s;
}

function normExitCode(v) {
  return Number.isInteger(v) && v >= -2147483648 && v <= 4294967295 ? v : null;
}

function normSignal(v) {
  return typeof v === 'string' && SIGNAL_RE.test(v) ? v : null;
}

// → { harness, exit_code, signal, stderr_tail } or null when there is no stderr to show
// (the caller then keeps the generic empty-reply placeholder).
function buildErrorDetail({ harness, exitCode, signal, stderr, home } = {}) {
  if (typeof harness !== 'string' || !HARNESS_NAME_RE.test(harness)) return null;
  const tail = stderrTail(stderr, home);
  if (!tail) return null;
  return { harness, exit_code: normExitCode(exitCode), signal: normSignal(signal), stderr_tail: tail };
}

// Server side: same shape from untrusted input, re-redacted and re-trimmed; null if malformed.
function sanitizeErrorDetail(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.exit_code != null && normExitCode(raw.exit_code) === null) return null;
  if (raw.signal != null && normSignal(raw.signal) === null) return null;
  return buildErrorDetail({ harness: raw.harness, exitCode: raw.exit_code, signal: raw.signal, stderr: raw.stderr_tail });
}

// The bubble text: "Harness codex failed (exit 1): <last error line>". The line naming an error
// wins over a trailing stack frame or hint.
function errorDetailSummary(detail) {
  const lines = detail.stderr_tail.split('\n').map(l => l.trim()).filter(Boolean);
  const line = [...lines].reverse().find(l => /error|fail|fatal|panic|denied|refused|not found|invalid/i.test(l)) || lines[lines.length - 1] || '';
  const status = detail.exit_code !== null ? `exit ${detail.exit_code}` : detail.signal ? `signal ${detail.signal}` : 'exit ?';
  const short = line.length > SUMMARY_LINE_MAX ? line.slice(0, SUMMARY_LINE_MAX - 1) + '…' : line;
  return `Harness ${detail.harness} failed (${status}): ${short}`;
}

module.exports = {
  redactSecrets, stderrTail, buildErrorDetail, sanitizeErrorDetail, errorDetailSummary,
  STDERR_TAIL_MAX_LINES, STDERR_TAIL_MAX_CHARS, STDERR_RAW_KEEP,
};
