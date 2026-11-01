'use strict';
// REST credential of a sub-agent session (owner decision 2026-11-01). A sub-agent runs inside its
// parent's stoa.js, which used to hand the parent's STOA_SECRET to the child, so its curl calls could
// reach every room of the parent. The server now mints this credential per sub-agent and sends it
// with each trigger; stoa.js puts it in the child's env as STOA_SECRET (the parent's secret is not
// passed on), so the curl patterns in the prompts keep working (x-agent-id: $STOA_ACTOR_ID,
// x-agent-secret: $STOA_SECRET) while lib/agent-scope.js narrows it to the sub-agent's rooms.
//
// Stateless: HMAC of (server signing key, parent, sub-agent, digest of the parent's secret). Stable,
// so the session env does not change between triggers; it stops working when the sub-agent is
// deleted (server.js re-checks that it still belongs to the parent) or when the parent's secret changes.
// It is never accepted on /mcp (that takes an MCP token only).
//
// Limit: the child has a shell on the parent's machine. This narrows the official path (env + API);
// it is not an OS sandbox — files the parent can read (its own agent config) stay readable.

const crypto = require('crypto');

const SHAPE = /^sa1\.(\d{1,15})\.([a-f0-9]{64})$/;
const digest = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
const mac = (key, actorId, subAgentId, actorSecret) =>
  crypto.createHmac('sha256', key).update(`sub-agent-secret|${actorId}|${subAgentId}|${digest(actorSecret)}`).digest('hex');

function mintSubAgentSecret(key, { actorId, subAgentId, actorSecret }) {
  return `sa1.${subAgentId}.${mac(key, actorId, subAgentId, actorSecret)}`;
}

// → the sub-agent id the credential was minted for, or null (wrong shape, other parent, stale secret).
function verifySubAgentSecret(key, secret, { actorId, actorSecret }) {
  const m = typeof secret === 'string' && secret.match(SHAPE);
  if (!m) return null;
  const subAgentId = Number(m[1]);
  const expected = Buffer.from(mac(key, actorId, subAgentId, actorSecret), 'hex');
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), expected) ? subAgentId : null;
}

module.exports = { mintSubAgentSecret, verifySubAgentSecret };
