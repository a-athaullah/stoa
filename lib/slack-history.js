'use strict';
// Read Slack messages through a running Slack connector: one message, a thread, or channel history.
// Shared by GET /api/automations/connections/:id/messages (provider slack) and the MCP tool
// stoa__connection_messages_read, so validation and error wording cannot drift between the two.
//
// The bot/user token never leaves connection-manager.js: this module only calls conn.readApi(method,
// args), and every Slack failure is reduced to its error code (a fixed ^[a-z_]+$ string) before it is
// returned or logged.

const MODES = ['message', 'thread', 'history'];
const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const TEXT_MAX = 4000;
const PERMALINK_MAX = 2048;
const CHANNEL_RE = /^[CGD][A-Z0-9]{2,30}$/;
const TS_RE = /^\d{1,12}\.\d{1,9}$/;
const SCOPE_HINT = 'channels:history (public channels), groups:history (private channels), im:history (DMs), mpim:history (group DMs)';

// https://<workspace>.slack.com/archives/<channel>/p<ts without dot>[?thread_ts=<ts>&cid=<channel>]
// → { channel, ts, thread_ts } or null when it is not a Slack message permalink.
function parseSlackPermalink(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > PERMALINK_MAX) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'slack.com' && !u.hostname.endsWith('.slack.com')) return null;
  const m = u.pathname.match(/^\/archives\/([CGD][A-Z0-9]{2,30})\/p(\d{7,12})(\d{6})\/?$/);
  if (!m) return null;
  const out = { channel: m[1], ts: `${m[2]}.${m[3]}`, thread_ts: null };
  const threadTs = u.searchParams.get('thread_ts');
  if (threadTs != null) {
    if (!TS_RE.test(threadTs)) return null;
    out.thread_ts = threadTs;
  }
  return out;
}

// Input → { channel, ts, thread_ts, mode, limit } or { error } (400).
function resolveTarget({ permalink, channel, ts, thread_ts, mode, limit } = {}) {
  let target;
  if (permalink != null && permalink !== '') {
    target = parseSlackPermalink(permalink);
    if (!target) return { error: 'invalid Slack permalink (expected https://<workspace>.slack.com/archives/<channel>/p<16 digits>)' };
  } else {
    if (typeof channel !== 'string' || !CHANNEL_RE.test(channel)) return { error: 'permalink or channel (Slack channel id, e.g. C0123ABCD) is required' };
    if (ts != null && ts !== '' && (typeof ts !== 'string' || !TS_RE.test(ts))) return { error: 'ts must look like 1712345678.123456' };
    if (thread_ts != null && thread_ts !== '' && (typeof thread_ts !== 'string' || !TS_RE.test(thread_ts))) return { error: 'thread_ts must look like 1712345678.123456' };
    target = { channel, ts: ts || null, thread_ts: thread_ts || null };
  }
  if (mode != null && mode !== '' && !MODES.includes(mode)) return { error: `mode must be one of ${MODES.join(', ')}` };
  const resolvedMode = mode || (target.ts || target.thread_ts ? 'thread' : 'history');
  if (resolvedMode !== 'history' && !target.ts && !target.thread_ts) return { error: `mode ${resolvedMode} needs a permalink or ts` };
  let n = LIMIT_DEFAULT;
  if (limit != null && limit !== '') {
    n = Number(limit);
    if (!Number.isInteger(n) || n < 1) return { error: `limit must be an integer 1-${LIMIT_MAX}` };
    n = Math.min(n, LIMIT_MAX);
  }
  return { ...target, mode: resolvedMode, limit: n };
}

const slackErrorCode = (e) => {
  if (e?.code === 'slack_webapi_rate_limited_error') return 'ratelimited';
  const c = e?.data?.error;
  return typeof c === 'string' && /^[a-z_]{1,64}$/.test(c) ? c : null;
};

// A Slack failure → { status, body } with a message the agent can act on. Only the error code is kept.
function slackFailure(e, channel) {
  const code = slackErrorCode(e);
  switch (code) {
    case 'missing_scope': {
      const needed = typeof e.data?.needed === 'string' && /^[a-z:,_.]{1,200}$/.test(e.data.needed) ? e.data.needed : null;
      return { status: 403, body: { error: `Slack token is missing a scope${needed ? ` (${needed})` : ''}: reading history needs ${SCOPE_HINT}. Add the scope in the Slack app, reinstall it, then reconnect.`, code: 'slack_missing_scope', ...(needed ? { needed } : {}) } };
    }
    case 'not_in_channel':
      return { status: 403, body: { error: `the Slack app is not a member of channel ${channel}; invite it there (/invite @<app>) and retry`, code: 'slack_not_in_channel' } };
    case 'channel_not_found':
      return { status: 404, body: { error: `Slack channel ${channel} not found, or not visible to this connector's token`, code: 'slack_channel_not_found' } };
    case 'thread_not_found':
      return { status: 404, body: { error: 'Slack thread not found', code: 'slack_thread_not_found' } };
    case 'ratelimited': {
      const retry = Number.isInteger(e.retryAfter) && e.retryAfter > 0 ? e.retryAfter : null;
      return { status: 429, body: { error: `Slack rate limit reached${retry ? `; retry in ${retry}s` : '; retry later'}`, code: 'slack_ratelimited', ...(retry ? { retry_after: retry } : {}) } };
    }
    case 'invalid_auth': case 'not_authed': case 'token_revoked': case 'account_inactive':
      return { status: 409, body: { error: 'the Slack connector token is no longer valid; reconnect it in Automations > Connections', code: `slack_${code}` } };
    default:
      return { status: 502, body: { error: `Slack API error: ${code || 'request failed'}`, code: 'slack_error' } };
  }
}

function brief(m, names) {
  const userId = m.user || null;
  const name = userId ? (names.get(userId) || userId) : (m.username || m.bot_profile?.name || m.bot_id || 'unknown');
  const text = String(m.text ?? '');
  const out = { ts: m.ts, user: name, user_id: userId || m.bot_id || null, text: text.slice(0, TEXT_MAX) };
  if (text.length > TEXT_MAX) out.truncated = true;
  if (m.thread_ts) out.thread_ts = m.thread_ts;
  if (m.reply_count) out.reply_count = m.reply_count;
  if (Array.isArray(m.files) && m.files.length) out.files = m.files.map(f => ({ name: f.name || f.title || null, mimetype: f.mimetype || null }));
  return out;
}

function createSlackHistory({ getConnectionRow, getSlackConnection, log = console }) {
  // One users.info per distinct user per request; failures fall back to the id.
  async function resolveNames(conn, messages) {
    const ids = [...new Set(messages.map(m => m.user).filter(u => typeof u === 'string' && /^[UW][A-Z0-9]{2,30}$/.test(u)))];
    const names = new Map();
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await conn.readApi('users.info', { user: id });
        const p = r.user?.profile || {};
        const n = p.display_name || p.real_name || r.user?.real_name || r.user?.name;
        if (n) names.set(id, String(n).slice(0, 80));
      } catch { /* the id is shown instead */ }
    }));
    return names;
  }

  async function fetchMessages(conn, t) {
    if (t.mode === 'history') {
      const args = { channel: t.channel, limit: t.limit };
      if (t.ts) Object.assign(args, { latest: t.ts, inclusive: true });
      const r = await conn.readApi('conversations.history', args);
      return { messages: r.messages || [], has_more: !!r.has_more };
    }
    if (t.mode === 'thread') {
      const r = await conn.readApi('conversations.replies', { channel: t.channel, ts: t.thread_ts || t.ts, limit: t.limit });
      return { messages: r.messages || [], has_more: !!r.has_more };
    }
    // message: a reply lives only in conversations.replies; a top-level message in history.
    const isReply = t.thread_ts && t.thread_ts !== t.ts;
    const r = isReply
      ? await conn.readApi('conversations.replies', { channel: t.channel, ts: t.thread_ts, oldest: t.ts, latest: t.ts, inclusive: true, limit: 2 })
      : await conn.readApi('conversations.history', { channel: t.channel, oldest: t.ts, latest: t.ts, inclusive: true, limit: 1 });
    return { messages: (r.messages || []).filter(m => m.ts === t.ts), has_more: false };
  }

  // input: { permalink?, channel?, ts?, thread_ts?, mode?, limit? } → { status, body }
  async function read(connId, input) {
    const row = getConnectionRow(connId);
    if (!row) return { status: 404, body: { error: 'Not found' } };
    if (row.provider !== 'slack') return { status: 400, body: { error: `connection ${connId} is a ${row.provider} connector; this reads Slack connectors only` } };
    const t = resolveTarget(input);
    if (t.error) return { status: 400, body: { error: t.error } };
    const conn = getSlackConnection(connId);
    if (row.status !== 'connected' || !conn || !conn.running) {
      return { status: 409, body: { error: `Slack connection ${connId} is not connected (status: ${row.status}); reconnect it in Automations > Connections`, code: 'not_connected' } };
    }
    let got;
    try {
      got = await fetchMessages(conn, t);
    } catch (e) {
      const f = slackFailure(e, t.channel);
      log.error(`[slack-history] conn=${connId} channel=${t.channel} mode=${t.mode} failed: ${slackErrorCode(e) || 'request failed'}`);
      return f;
    }
    if (t.mode === 'message' && !got.messages.length) return { status: 404, body: { error: 'Slack message not found', code: 'slack_message_not_found' } };
    const sorted = got.messages.filter(m => m && typeof m.ts === 'string').sort((a, b) => Number(a.ts) - Number(b.ts));
    const names = await resolveNames(conn, sorted);
    return { status: 200, body: { connection_id: connId, channel: t.channel, mode: t.mode, messages: sorted.map(m => brief(m, names)), has_more: got.has_more } };
  }

  return { read };
}

module.exports = { createSlackHistory, parseSlackPermalink, resolveTarget, LIMIT_MAX };
