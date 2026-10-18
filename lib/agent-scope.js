'use strict';
// Least privilege for agent secrets (x-agent-id / x-agent-secret without a human session).
// An agent reads untrusted content (WA, email, Slack, web), so a prompt-injected agent must not be
// able to reach admin APIs. Only routes with proven agent usage are listed; the evidence is the
// file:line that tells an agent to call it (or the agent client code that calls it).
//
// scope:
//   'room'       — agent must be a participant of the room in the path (capture group 1)
//   'self'       — the actor id in the path must be the agent itself
//   'sub-agent'  — the sub-agent in the path must belong to the agent
//   'connection' — the connector must feed an automation targeting a room the agent is in
//   'any'        — a valid agent is enough

const AGENT_ALLOWED_ROUTES = [
  // Proactive message: server.js PROACTIVE_INSTRUCTIONS / PROACTIVE_INSTRUCTIONS_SUB_AGENT; docs/stoa-api.md "Send a Message"
  { method: 'POST', re: /^\/api\/rooms\/(\d+)\/message$/, scope: 'room' },
  // Email thread reply: lib/email-threading.js:23 (curl in prompt); docs/stoa-api.md "Reply to Email Thread"
  { method: 'POST', re: /^\/api\/rooms\/(\d+)\/email-reply$/, scope: 'room' },
  // Room memory: server.js room-memory prompt section (curl PUT .../rooms/$STOA_ROOM_ID/memory); docs/stoa-api.md "Read/Update Room Memory"
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/memory$/, scope: 'room' },
  { method: 'PUT', re: /^\/api\/rooms\/(\d+)\/memory$/, scope: 'room' },
  // Room system prompt: docs/stoa-api.md "Read/Update Room System Prompt"
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/system-prompt$/, scope: 'room' },
  { method: 'PUT', re: /^\/api\/rooms\/(\d+)\/system-prompt$/, scope: 'room' },
  // Sub-agent spawn: agent-only endpoint (server.js handler requires verifyAgentRequest)
  { method: 'POST', re: /^\/api\/rooms\/(\d+)\/sub-agent-trigger$/, scope: 'room' },
  // Read-only room context for participants (history / threads)
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/messages$/, scope: 'room' },
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/threads$/, scope: 'room' },
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/threads\/\d+$/, scope: 'room' },
  // File upload: stoa.js extractAndUploadFiles (fetch /api/upload/raw with agent headers); docs/stoa-api.md "Upload a File"
  { method: 'POST', re: /^\/api\/upload\/raw$/, scope: 'any' },
  // File download with agent headers: docs/stoa-api.md "/uploads/* URLs require ... agent credentials"
  { method: 'GET', re: /^\/uploads\//, scope: 'any' },
  { method: 'GET', re: /^\/connector-media\//, scope: 'any' },
  // API docs in the agent's language: server.js DEFAULT_BASE_SYSTEM_PROMPT (curl $BASE_URL/api/docs/stoa-api.md); docs/stoa-api.<lang>.md
  { method: 'GET', re: /^\/api\/docs\/stoa-api(\.[a-z]{2})?\.md$/, scope: 'any' },
  // Agent memory: server.js agent-memory prompt section (curl PUT .../actors/$STOA_ACTOR_ID/memory/MEMORY.md)
  { method: 'GET', re: /^\/api\/actors\/(\d+)\/memory$/, scope: 'self' },
  { method: 'PUT', re: /^\/api\/actors\/(\d+)\/memory\/(MEMORY|USER)\.md$/, scope: 'self' },
  // Agent's own system prompt: server.js handler allows reqAgentId === actorId
  { method: 'GET', re: /^\/api\/actors\/(\d+)\/system-prompt$/, scope: 'self' },
  { method: 'PUT', re: /^\/api\/actors\/(\d+)\/system-prompt$/, scope: 'self' },
  // Sub-agent self-learning memory: server.js sub-agent prompt section (curl PUT .../sub-agents/<id>/memory)
  { method: 'GET', re: /^\/api\/sub-agents\/(\d+)\/memory$/, scope: 'sub-agent' },
  { method: 'PUT', re: /^\/api\/sub-agents\/(\d+)\/memory$/, scope: 'sub-agent' },
  // WA chat history: server.js WhatsApp automation prompt ("To read recent chat history: curl .../connections/<id>/messages")
  { method: 'GET', re: /^\/api\/automations\/connections\/(\d+)\/messages$/, scope: 'connection' },
];

// → { scope, id } (id = numeric path capture, or null) | null when the route is not allowed.
function matchAgentRoute(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return null;
  for (const r of AGENT_ALLOWED_ROUTES) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    return { scope: r.scope, id: m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : null };
  }
  return null;
}

// Escape hatch, read from the server env only (a client cannot toggle it).
function agentScopeEnforced(envValue) {
  return String(envValue ?? '').trim().toLowerCase() !== 'off';
}

module.exports = { AGENT_ALLOWED_ROUTES, matchAgentRoute, agentScopeEnforced };
