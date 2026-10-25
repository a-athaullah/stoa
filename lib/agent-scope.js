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
//   'automation' — the automation in the path must target a room the agent is in
//   'any'        — a valid agent is enough
//
// The built-in MCP tools (lib/stoa-mcp-tools.js) apply the same scopes from the session token. Their
// one addition is create / update / delete of the agent's OWN sub-agents (owner decision 2026-10-25);
// over HTTP those routes stay session-only.

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
  // Agents build automations on request (owner decision, PR #171). Handlers narrow these further:
  // list → only automations targeting the agent's rooms; create/update → target room must be one of
  // the agent's rooms; connections → id/name/provider/status only, never credentials.
  // Connection create/edit/delete, test-email and Slack connect stay session-only.
  { method: 'GET', re: /^\/api\/automations$/, scope: 'any' },
  { method: 'POST', re: /^\/api\/automations$/, scope: 'any' },
  { method: 'PATCH', re: /^\/api\/automations\/(\d+)$/, scope: 'automation' },
  { method: 'DELETE', re: /^\/api\/automations\/(\d+)$/, scope: 'automation' },
  { method: 'GET', re: /^\/api\/automations\/connections$/, scope: 'any' },
  // Agents build scheduled triggers on request (owner decision, 2026-10-24). Handler narrows further:
  // target must be an AI participant of the same room, schedule ids resolve only inside their room,
  // and every agent change posts a " · schedule" system notice in the room.
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/schedules$/, scope: 'room' },
  { method: 'POST', re: /^\/api\/rooms\/(\d+)\/schedules$/, scope: 'room' },
  { method: 'GET', re: /^\/api\/rooms\/(\d+)\/schedules\/doctor$/, scope: 'room' },
  { method: 'PATCH', re: /^\/api\/rooms\/(\d+)\/schedules\/\d+$/, scope: 'room' },
  { method: 'DELETE', re: /^\/api\/rooms\/(\d+)\/schedules\/\d+$/, scope: 'room' },
  // Deliberately absent: GET /api/search and GET /api/search/status. Search over HTTP spans every
  // room, and the status payload (backfill progress, model errors) only drives the human search UI.
  // Agents search through the WS agent_search message, which is scoped to their rooms and already
  // gets the semantic half. Not a finding.
];

// Routes that authenticate themselves with their own credential and are skipped by the cookie /
// agent-secret middleware. The handler MUST verify that credential before doing anything else.
//   /mcp — MCP gateway (lib/mcp-gateway.js). Auth is a per-session MCP bearer token from mcp_tokens;
//          an agent secret is never accepted there, and the token is useless on any other route
//          (it is not a session cookie and not an agent secret). Admin routes /api/mcp/* stay
//          session-only: they are absent from AGENT_ALLOWED_ROUTES on purpose (installing an MCP
//          server runs a command on the Stoa server).
const SELF_AUTHENTICATED_PATHS = new Set(['/mcp']);
function isSelfAuthenticatedPath(pathname) {
  return SELF_AUTHENTICATED_PATHS.has(pathname);
}

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

module.exports = { AGENT_ALLOWED_ROUTES, matchAgentRoute, agentScopeEnforced, isSelfAuthenticatedPath };
