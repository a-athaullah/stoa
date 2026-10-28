'use strict';
// Built-in MCP tools for Stoa's own features (served by lib/mcp-gateway.js as stoa__<name>): room
// messages, memories, system prompts, sub-agents, automations and skills. Every tool calls the same
// core as its HTTP route (lib/room-messages.js, stoa-memory.js, system-prompts.js, sub-agents.js,
// automation-crud.js, skills.js), so validation cannot drift between the two paths.
//
// Scope comes from the MCP token (ident) only, never from arguments — same rules as lib/agent-scope.js:
//   room tools      → ident.roomId, and the agent must be a participant of it
//   actor tools     → ident.actorId only
//   sub-agent tools → only sub-agents whose parent is ident.actorId (others resolve as "not found")
//   automations     → only automations targeting a room the agent is in
//   skills          → global reads; create/update/delete only on skills this agent (or, for the parent,
//                     one of its sub-agents) created — others resolve as "not found" (lib/skills.js)
// A sub-agent session (ident.subAgentId set) may post, read, and read/write its OWN memory, and manage
// its OWN system_prompt / description / role / avatar via self_get / self_update / self_avatar_set
// (owner decision 2026-10-28). Its label, tier, model, harness, workdir and enabled stay with the
// parent: label drives @mention routing, model/tier are cost, harness/workdir are machine access, and
// enabled:false would let it park itself — a request for them is refused (400), never dropped. Tools
// that change other configuration (sub-agent CRUD, system prompts, memories of the parent or the room,
// automations, triggering sub-agents) and sub_agent_list are hidden from it and refused (availableTo).
// Skills are open to sub-agent sessions too: a skill it creates is its own, and its parent may manage it.
// Configuration changes post a " · config" notice in the session's room so the owner sees them.

const { AVATAR_MAX_BYTES } = require('./avatar-image');
const { SYSTEM_PROMPT_MAX_BYTES } = require('./system-prompts');
const { TEXT_READ_MAX } = require('./skills');
const { DESCRIPTION_MAX, ARGUMENT_HINT_MAX } = require('./skill-bundle');

const CONTENT_MAX = 4000;            // per message in read results; the full text stays in the room
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });
const asResult = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r.body ?? { ok: true }) }], ...(r.status >= 400 ? { isError: true } : {}) });
const PATH_MAX = 4096;
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);
// Body + files of one skill_create / skill_update call. The /mcp request body cap (server.js) leaves
// room for this much as base64; bigger bundles go through POST /api/skills/import.
const MCP_SKILL_BYTES = 5 * 1024 * 1024;
const skillFail = (status, code, error) => ({ status, body: { error, code } });
const clamp = (v, def, max) => Math.min(posInt(v) ?? def, max);
const mainSession = (ident) => ident.subAgentId == null;
const subAgentSession = (ident) => ident.subAgentId != null;
// What a sub-agent session may change about itself (self_update); everything else is the parent's.
const SELF_FIELDS = ['system_prompt', 'description', 'role'];

// Compact message for agents: who, what, when, where — no avatar / UI fields.
function brief(m) {
  const content = String(m.content ?? '');
  const out = { id: m.id, author: m.actor_name, author_type: m.actor_type, content: content.slice(0, CONTENT_MAX), created_at: m.created_at, thread_id: m.thread_id ?? null };
  if (content.length > CONTENT_MAX) out.truncated = true;
  if (m.sub_agent_label) out.sub_agent = m.sub_agent_label;
  if (m.state && m.state !== 'complete') out.state = m.state;
  let files = [];
  try { files = m.attachments ? JSON.parse(m.attachments).map(a => a.name) : (m.file_name ? [m.file_name] : []); } catch { files = []; }
  if (files.length) out.files = files;
  if (m.thread?.count) out.thread = { replies: m.thread.count, last_at: m.thread.last_at, active: m.thread.active };
  return out;
}

const SUMMARY_FIELDS = ['id', 'label', 'role', 'description', 'tier', 'model', 'harness', 'effective_harness', 'enabled', 'avatar_color', 'avatar_symbol', 'avatar_url'];
const subAgentSummary = (r) => ({ ...Object.fromEntries(SUMMARY_FIELDS.map(k => [k, r[k] ?? null])), has_system_prompt: !!r.system_prompt });
const OBJ = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true };
const THREAD_ARG = { type: 'integer', minimum: 1, description: 'Thread root message id. Defaults to the thread this session runs in.' };
const MAIN_FEED_ARG = { type: 'boolean', description: 'true = post in the room\'s main feed instead of the current thread' };
const SUB_FIELDS = {
  label: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,29}$', description: 'Name used to @mention it; letter first, 1-30 chars' },
  tier: { type: 'string', enum: ['quick', 'standard', 'deep'] },
  model: { type: ['string', 'null'], description: 'Model id for its harness; null = harness default' },
  workdir: { type: ['string', 'null'], description: 'Working directory on your machine; null = yours' },
  system_prompt: { type: ['string', 'null'], description: 'Its instructions (role, rules, output format)' },
  harness: { type: ['string', 'null'], description: 'Harness name; null = inherit yours' },
  description: { type: ['string', 'null'], maxLength: 500 },
  role: { type: ['string', 'null'], maxLength: 40, description: 'Short role shown next to its name' },
};
const AUTO_FIELDS = {
  name: { type: 'string', minLength: 1 },
  trigger_type: { type: 'string', enum: ['slack', 'whatsapp', 'email'], description: 'Default "slack"; fixed after creation' },
  trigger_event: { type: 'string', description: 'Slack: a Slack event name (message, app_mention, reaction_added…). WhatsApp: message | group_message | group_mention | message_any. Email: message' },
  trigger_conditions: {
    type: 'array', items: { type: 'object' },
    description: 'All must match: [{"field","op","value"}], op contains | not_contains | starts_with | matches_regex. '
      + 'Fields — Slack: message_text, slack_full_text, slack_user, slack_channel, slack_bot_id, reaction. WhatsApp: message_text, wa_sender, wa_chat_id. Email: from, subject, body, has_attachments',
  },
  prompt_template: {
    type: 'string', minLength: 1,
    description: 'Posted to the target room when it fires. Placeholders — Slack: {{slack_message_text}} {{slack_user}} {{slack_channel}} {{slack_message_link}} {{slack_thread_ts}} {{slack_full_text}} {{extracted_url}}. '
      + 'WhatsApp: {{wa_message_text}} {{wa_sender}} {{wa_sender_name}} {{wa_chat_id}} {{wa_is_group}}. Email: {{email.from}} {{email.subject}} {{email.body}} {{email.date}}',
  },
  connection_id: { type: ['integer', 'null'], description: 'Connector id (stoa__connection_list)' },
  reply_mode: { type: 'string', enum: ['none', 'reply_wa'], description: '"none" (default); "reply_wa" (WhatsApp only) sends the agent\'s answer back to the chat' },
  watch_reply: { type: 'boolean', description: 'Slack/email: also fire on replies in the same thread' },
  enabled: { type: 'boolean' },
};
// trigger_type is fixed after creation (the update path ignores it).
const AUTO_UPDATE_FIELDS = Object.fromEntries(Object.entries(AUTO_FIELDS).filter(([k]) => k !== 'trigger_type'));
const SKILL_NAME = { type: 'string', pattern: '^[a-z][a-z0-9-]{1,47}$', description: 'Skill name (what /name invokes)' };
const SKILL_FILES = {
  type: 'array',
  items: OBJ({
    path: { type: 'string', minLength: 1, maxLength: 200, description: 'Relative path inside the skill, e.g. scripts/run.py (not SKILL.md)' },
    content: { type: 'string', description: 'Text content (UTF-8)' },
    content_base64: { type: 'string', description: 'Binary content, base64 — instead of content' },
    mode: { type: 'integer', enum: [420, 493], description: '420 = 0644 (default), 493 = 0755 (executable)' },
  }, ['path']),
};
const SKILL_FIELDS = {
  description: { type: 'string', minLength: 1, maxLength: DESCRIPTION_MAX, description: 'One line: what it does and when to use it (shown in every agent\'s skill list)' },
  argument_hint: { type: 'string', maxLength: ARGUMENT_HINT_MAX, description: 'Optional, e.g. "<branch> [--fast]"' },
  body: { type: 'string', description: 'The SKILL.md instructions, without frontmatter (max 64 KB)' },
  note: { type: 'string', maxLength: 300, description: 'Optional change note for this version' },
};
const base64Bytes = (s) => Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);

// MCP file entries ({path, content} | {path, content_base64, mode?}) → the lib's {path, content_base64,
// mode} shape + their size. Paths, modes and base64 are validated by lib/skills.js.
function skillFiles(list, field) {
  if (list === undefined) return { files: undefined, bytes: 0 };
  if (!Array.isArray(list)) return { err: skillFail(400, 'invalid_files', `${field} must be an array`) };
  let bytes = 0;
  const files = [];
  for (const f of list) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { err: skillFail(400, 'invalid_files', `${field} entries must be objects`) };
    const text = f.content !== undefined;
    const label = String(f.path ?? '').slice(0, 200);
    if (text === (f.content_base64 !== undefined)) return { err: skillFail(400, 'invalid_files', `${label}: send content (text) or content_base64 (binary), not both`) };
    if (typeof (text ? f.content : f.content_base64) !== 'string') return { err: skillFail(400, 'invalid_files', `${label}: content must be a string`) };
    bytes += text ? Buffer.byteLength(f.content) : base64Bytes(f.content_base64);
    files.push({ path: f.path, content_base64: text ? Buffer.from(f.content, 'utf8').toString('base64') : f.content_base64, mode: f.mode });
  }
  return { files, bytes };
}
const tooBig = (bytes) => (bytes > MCP_SKILL_BYTES
  ? skillFail(400, 'too_large', `${bytes} bytes is over the ${MCP_SKILL_BYTES / 1048576} MB a skill tool call can carry. Zip the skill folder and POST it to /api/skills/import with curl (x-agent-id / x-agent-secret headers)`)
  : null);

// syncAgentSkill(actorId, ref) → Promise<{dir, version, stale}> when the agent's stoa.js cached the
// skill, {error} when it failed or did not answer, {unavailable} when it cannot (offline, old client).
function stoaMcpTools({ db, broadcast, messages, memory, prompts, subAgents, automations, readAgentImage, skills, syncAgentSkill, now = () => new Date() }) {
  const q = {
    room: db.prepare('SELECT id FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    noticeAuthor: db.prepare(`SELECT rp.id, a.name FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1`),
    insertNotice: db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')"),
  };
  const clean = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);

  // Persistent "· config" bubble (kept by the history filters) in the session's room.
  function notice(ident, text) {
    if (ident.roomId == null) return;
    const part = q.noticeAuthor.get(ident.roomId, ident.actorId);
    if (!part) return;
    const content = `${clean(part.name, 64)} ${text} · config`;
    const r = q.insertNotice.run(ident.roomId, part.id, content);
    broadcast(ident.roomId, { type: 'message_new', message: { id: Number(r.lastInsertRowid), room_id: ident.roomId, content, state: 'system_event', created_at: now().toISOString() } });
  }

  const argsOf = (args) => (args && typeof args === 'object' && !Array.isArray(args) ? args : {});
  const actorTool = (fn) => (ident, args) => asResult(fn(ident, argsOf(args)));
  // Room tools: the session must belong to a room the agent is still a participant of.
  const roomTool = (fn) => (ident, args) => {
    if (ident.roomId == null) return asResult(fail(400, 'this MCP session is not bound to a room'));
    if (!q.room.get(ident.roomId)) return asResult(fail(404, 'room not found'));
    if (!q.inRoom.get(ident.roomId, ident.actorId)) return asResult(fail(403, 'agent_scope_denied'));
    return asResult(fn(ident, argsOf(args)));
  };
  const pick = (args, keys) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  // Thread for a post: explicit thread_id, else main feed on request, else the session's thread.
  const threadFor = (ident, args) => {
    if (args.main_feed === true && args.thread_id !== undefined) return { err: fail(400, 'send either thread_id or main_feed, not both') };
    if (args.thread_id !== undefined) return posInt(args.thread_id) ? { id: args.thread_id } : { err: fail(400, 'thread_id must be a positive integer') };
    return { id: args.main_feed === true ? null : (ident.threadId ?? null) };
  };
  // Sub-agent memory target: a sub-agent session only ever reaches its own row.
  const subAgentTarget = (ident, args) => {
    if (ident.subAgentId != null) {
      if (args.sub_agent_id !== undefined && args.sub_agent_id !== ident.subAgentId) return { err: fail(403, 'forbidden') };
      return { id: ident.subAgentId };
    }
    const id = posInt(args.sub_agent_id);
    if (!id) return { err: fail(400, 'sub_agent_id required') };
    const denied = memory.subAgentAccess(id, ident.actorId);
    return denied ? { err: denied.status === 403 ? fail(404, 'sub-agent not found') : denied } : { id };
  };

  const skillCaller = (ident) => ({ actorId: ident.actorId, subAgentId: ident.subAgentId ?? null });
  // A mutation by name; a skill the caller may not change answers exactly like a missing one.
  const skillById = (name, fn) => {
    const id = skills.idByName(name);
    return id ? fn(id) : skillFail(404, 'not_found', 'Skill not found');
  };
  const skillShape = (r) => (r.status < 300 ? ok({ ok: true, skill: { name: r.body.skill.name, version: r.body.skill.version, description: r.body.skill.description, file_count: r.body.skill.file_count } }) : r);

  const tools = [
    // ── Messages ──
    {
      name: 'message_send',
      description: 'Post a message in the room of this session — by default into the thread this session runs in. Use it for progress updates on long tasks; your final answer is posted automatically, so do not send it again. An @label in the content runs that sub-agent (do not also call stoa__sub_agent_trigger for it).',
      inputSchema: OBJ({ content: { type: 'string', minLength: 1 }, thread_id: THREAD_ARG, main_feed: MAIN_FEED_ARG, event_id: { type: 'string', maxLength: 128, description: 'Idempotency key: a retry with the same key and content does not post twice' } }, ['content']),
      annotations: WRITE,
      call: roomTool((ident, args) => {
        const t = threadFor(ident, args);
        if (t.err) return t.err;
        return messages.send(ident.roomId, ident.actorId, {
          content: args.content, event_id: args.event_id, thread_id: t.id,
          ...(ident.subAgentId != null ? { sub_agent_id: ident.subAgentId } : {}),
        });
      }),
    },
    {
      name: 'messages_read',
      description: 'Read the latest messages of this room\'s main feed (oldest first). Thread replies are summarized on their root unless include_thread_replies is true. Page back with before_id = the id of the first message you got.',
      inputSchema: OBJ({
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20' },
        before_id: { type: 'integer', minimum: 1 },
        include_thread_replies: { type: 'boolean' },
      }),
      annotations: READ,
      call: roomTool((ident, args) => {
        const r = messages.feed(ident.roomId, { before: posInt(args.before_id) ?? Number.MAX_SAFE_INTEGER, limit: clamp(args.limit, 20, 100), scopeAll: args.include_thread_replies === true });
        return r.status === 200 ? ok({ messages: r.body.map(brief) }) : r;
      }),
    },
    {
      name: 'threads_list',
      description: 'List the threads of this room, most recently active first. state "active" = only threads with an agent still working.',
      inputSchema: OBJ({ state: { type: 'string', enum: ['all', 'active'] } }),
      annotations: READ,
      call: roomTool((ident, args) => {
        const r = messages.threads(ident.roomId, args.state === 'active' ? 'active' : 'all');
        if (r.status !== 200) return r;
        return ok({ threads: r.body.map(t => ({ id: t.id, author: t.actor_name, preview: String(t.content ?? '').slice(0, 200), created_at: t.created_at, replies: t.reply_count, last_reply_at: t.last_reply_at })) });
      }),
    },
    {
      name: 'thread_read',
      description: 'Read one thread of this room: its root and the latest replies (oldest first). Defaults to the thread this session runs in. Page back with before_id.',
      inputSchema: OBJ({ thread_id: THREAD_ARG, limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50' }, before_id: { type: 'integer', minimum: 1 } }),
      annotations: READ,
      call: roomTool((ident, args) => {
        const rootId = args.thread_id !== undefined ? posInt(args.thread_id) : ident.threadId;
        if (!rootId) return fail(400, args.thread_id !== undefined ? 'thread_id must be a positive integer' : 'thread_id required (this session is not in a thread)');
        const r = messages.thread(ident.roomId, rootId, { before: posInt(args.before_id), limit: clamp(args.limit, 50, 200) });
        return r.status === 200 ? ok({ thread_id: rootId, root: brief(r.body.root), messages: r.body.messages.map(brief) }) : r;
      }),
    },

    // ── Room memory ──
    {
      name: 'room_memory_get',
      description: 'Read this room\'s shared memory (facts every agent in the room sees).',
      inputSchema: OBJ({}),
      annotations: READ,
      call: roomTool((ident) => memory.roomGet(ident.roomId)),
    },
    {
      name: 'room_memory_set',
      description: 'Replace this room\'s shared memory with the full curated content (max 1800 chars). Read it first and merge — this overwrites.',
      inputSchema: OBJ({ content: { type: 'string', maxLength: 1800 } }, ['content']),
      annotations: WRITE,
      availableTo: mainSession,
      call: roomTool((ident, args) => memory.roomSet(ident.roomId, { content: args.content })),
    },

    // ── Agent memory ──
    {
      name: 'agent_memory_get',
      description: 'Read your own memory files: MEMORY.md (your notes) and USER.md (about the owner).',
      inputSchema: OBJ({}),
      annotations: READ,
      availableTo: mainSession,
      call: actorTool((ident) => memory.agentGet(ident.actorId)),
    },
    {
      name: 'agent_memory_set',
      description: 'Replace one of your memory files with the full curated content (MEMORY.md max 2200 chars, USER.md max 1375). Read it first and merge — this overwrites.',
      inputSchema: OBJ({ file: { type: 'string', enum: ['MEMORY.md', 'USER.md'] }, content: { type: 'string' } }, ['file', 'content']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => memory.agentSet(ident.actorId, args.file, { content: args.content })),
    },

    // ── Sub-agent memory ──
    {
      name: 'sub_agent_memory_get',
      description: 'Read a sub-agent\'s self-learning memory. In a sub-agent session: your own (no argument needed).',
      inputSchema: OBJ({ sub_agent_id: { type: 'integer', minimum: 1, description: 'One of your sub-agents (stoa__sub_agent_list); omit in a sub-agent session' } }),
      annotations: READ,
      call: actorTool((ident, args) => {
        const t = subAgentTarget(ident, args);
        return t.err || memory.subAgentGet(t.id);
      }),
    },
    {
      name: 'sub_agent_memory_set',
      description: 'Replace a sub-agent\'s self-learning memory with the full curated content (max 2200 chars). In a sub-agent session: your own. Read it first and merge — this overwrites.',
      inputSchema: OBJ({ sub_agent_id: { type: 'integer', minimum: 1, description: 'One of your sub-agents; omit in a sub-agent session' }, content: { type: 'string', maxLength: 2200 } }, ['content']),
      annotations: WRITE,
      call: actorTool((ident, args) => {
        const t = subAgentTarget(ident, args);
        return t.err || memory.subAgentSet(t.id, { content: args.content });
      }),
    },

    // ── Sub-agent self-config (sub-agent sessions only; the parent uses sub_agent_update / _avatar_set) ──
    {
      name: 'self_get',
      description: 'Read your own sub-agent configuration: label, role, description, system_prompt, tier, model, harness, workdir, avatar.',
      inputSchema: OBJ({}),
      annotations: READ,
      availableTo: subAgentSession,
      call: actorTool((ident) => {
        const sa = subAgents.list(ident.actorId).body.find(r => r.id === ident.subAgentId);
        return sa ? ok({ sub_agent: sa }) : fail(404, 'sub-agent not found');
      }),
    },
    {
      name: 'self_update',
      description: 'Change your own system_prompt, description or role. Send only the fields to change; takes effect from your next run. '
        + 'Label, tier, model, harness, workdir and enabled belong to your parent and are refused. The room sees a notice.',
      inputSchema: OBJ({
        system_prompt: { type: ['string', 'null'], description: `Your instructions (role, rules, output format); null clears it, max ${SYSTEM_PROMPT_MAX_BYTES / 1024}KB` },
        description: SUB_FIELDS.description,
        role: SUB_FIELDS.role,
      }),
      annotations: WRITE,
      availableTo: subAgentSession,
      call: actorTool((ident, args) => {
        const t = subAgentTarget(ident, args);
        if (t.err) return t.err;
        const refused = Object.keys(args).filter(k => k !== 'sub_agent_id' && !SELF_FIELDS.includes(k));
        if (refused.length) return fail(400, `not changeable from a sub-agent session: ${refused.map(k => clean(k, 40)).join(', ')}`);
        const data = pick(args, SELF_FIELDS);
        if (!Object.keys(data).length) return fail(400, 'nothing to update');
        if (data.system_prompt != null && (typeof data.system_prompt !== 'string' || Buffer.byteLength(data.system_prompt) > SYSTEM_PROMPT_MAX_BYTES)) {
          return fail(400, typeof data.system_prompt !== 'string' ? 'system_prompt must be a string or null' : 'system_prompt exceeds 64KB limit');
        }
        const r = subAgents.update(t.id, data, { parentActorId: ident.actorId });
        if (r.status !== 200) return r;
        notice(ident, `(sub-agent ${clean(r.body.label, 30)}) updated its own ${Object.keys(data).join(', ')}`);
        return ok({ ok: true, sub_agent: r.body });
      }),
    },
    {
      name: 'self_avatar_set',
      description: `Set your own avatar from an image file on this machine: absolute path, png / jpeg / webp / gif, max ${AVATAR_MAX_BYTES / 1024} KB (resize to 256 px first). The room shows it at once and sees a notice.`,
      inputSchema: OBJ({ path: { type: 'string', minLength: 1, maxLength: PATH_MAX, description: 'Absolute path of the image file (~/ allowed)' } }, ['path']),
      annotations: WRITE,
      availableTo: subAgentSession,
      // A sub-agent runs on its parent's machine: the path goes to the parent's stoa.js only.
      call: async (ident, rawArgs) => {
        const args = argsOf(rawArgs);
        const t = subAgentTarget(ident, args);
        if (t.err) return asResult(t.err);
        if (typeof args.path !== 'string' || !args.path || args.path.length > PATH_MAX) return asResult(fail(400, 'path required'));
        const denied = memory.subAgentAccess(t.id, ident.actorId);
        if (denied) return asResult(denied.status === 403 ? fail(404, 'sub-agent not found') : denied);
        const file = await readAgentImage(ident.actorId, args.path);
        if (file.error) return asResult(fail(file.status, file.error));
        const r = subAgents.setAvatar(t.id, Buffer.from(file.base64, 'base64'), { parentActorId: ident.actorId });
        if (r.status !== 200) return asResult(r);
        notice(ident, `(sub-agent ${clean(r.body.sub_agent.label, 30)}) set its own avatar`);
        return asResult(ok({ ok: true, avatar_url: r.body.avatar_url }));
      },
    },

    // ── System prompts ──
    {
      name: 'room_system_prompt_get',
      description: 'Read this room\'s system prompt (instructions every agent in the room gets) and its max_active_threads.',
      inputSchema: OBJ({}),
      annotations: READ,
      call: roomTool((ident) => prompts.roomGet(ident.roomId)),
    },
    {
      name: 'room_system_prompt_set',
      description: 'Replace this room\'s system prompt (null clears it) and/or max_active_threads (1-20). The room sees a notice.',
      inputSchema: OBJ({ system_prompt: { type: ['string', 'null'] }, max_active_threads: { type: 'integer', minimum: 1, maximum: 20 } }),
      annotations: WRITE,
      availableTo: mainSession,
      call: roomTool((ident, args) => {
        const data = pick(args, ['system_prompt', 'max_active_threads']);
        if (!Object.keys(data).length) return fail(400, 'nothing to update');
        const r = prompts.roomSet(ident.roomId, data);
        if (r.status === 200) notice(ident, 'updated the room system prompt');
        return r;
      }),
    },
    {
      name: 'agent_system_prompt_get',
      description: 'Read your own agent system prompt (your persona and standing instructions).',
      inputSchema: OBJ({}),
      annotations: READ,
      availableTo: mainSession,
      call: actorTool((ident) => prompts.actorGet(ident.actorId)),
    },
    {
      name: 'agent_system_prompt_set',
      description: 'Replace your own agent system prompt (null clears it, max 64KB). Takes effect from your next turn. The room sees a notice.',
      inputSchema: OBJ({ system_prompt: { type: ['string', 'null'] } }, ['system_prompt']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const r = prompts.actorSet(ident.actorId, { system_prompt: args.system_prompt });
        if (r.status === 200) notice(ident, 'updated their agent system prompt');
        return r;
      }),
    },

    // ── Sub-agents ──
    {
      name: 'sub_agent_list',
      description: 'List your sub-agents (helpers you run by @label or stoa__sub_agent_trigger) as a summary without system prompts. Pass sub_agent_id to get one sub-agent in full, system_prompt and workdir included.',
      inputSchema: OBJ({ sub_agent_id: { type: 'integer', minimum: 1, description: 'Return this one sub-agent of yours in full' } }),
      annotations: READ,
      // A sub-agent session would list its siblings (full system_prompt and workdir by id): it reads
      // untrusted content and has no tool that acts on a sibling, so it gets self_get instead.
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const rows = subAgents.list(ident.actorId).body;
        if (args.sub_agent_id !== undefined) {
          const sa = rows.find(r => r.id === args.sub_agent_id);
          return sa ? ok({ sub_agent: sa }) : fail(404, 'sub-agent not found');
        }
        // Full system prompts made the list hundreds of KB for a dozen sub-agents, past tool-output limits.
        return ok({ sub_agents: rows.map(subAgentSummary) });
      }),
    },
    {
      name: 'sub_agent_create',
      description: `Create a sub-agent of yours. By default it is also linked to this room so it can be @mentioned here. Max ${subAgents.limit} sub-agents per agent. The room sees a notice.`,
      inputSchema: OBJ({ ...SUB_FIELDS, link_to_room: { type: 'boolean', description: 'Default true when this session is in a room' } }, ['label']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const link = args.link_to_room !== false && ident.roomId != null;
        if (link && !q.inRoom.get(ident.roomId, ident.actorId)) return fail(403, 'agent_scope_denied');
        // Create and link succeed or fail together: no half-made sub-agent when the label is taken in the room.
        let linkErr = null;
        let r;
        try {
          r = db.transaction(() => {
            const created = subAgents.create(ident.actorId, pick(args, Object.keys(SUB_FIELDS)));
            if (created.status !== 201 || !link) return created;
            const l = subAgents.link(ident.roomId, created.body.id);
            if (l.status !== 200) { linkErr = l; throw new Error('link failed'); }
            return created;
          })();
        } catch (e) {
          if (linkErr) return linkErr;
          throw e;
        }
        if (r.status !== 201) return r;
        notice(ident, `created sub-agent ${clean(r.body.label, 30)}`);
        return ok({ ok: true, sub_agent: r.body, linked_to_room: link });
      }),
    },
    {
      name: 'sub_agent_update',
      description: 'Change one of your sub-agents. Send only the fields to change; enabled:false parks it. The room sees a notice.',
      inputSchema: OBJ({ sub_agent_id: { type: 'integer', minimum: 1 }, ...SUB_FIELDS, enabled: { type: 'boolean' } }, ['sub_agent_id']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const id = posInt(args.sub_agent_id);
        if (!id) return fail(400, 'sub_agent_id required');
        const r = subAgents.update(id, pick(args, [...Object.keys(SUB_FIELDS), 'enabled']), { parentActorId: ident.actorId });
        if (r.status !== 200) return r;
        notice(ident, `updated sub-agent ${clean(r.body.label, 30)}`);
        return ok({ ok: true, sub_agent: r.body });
      }),
    },
    {
      name: 'sub_agent_avatar_set',
      description: `Set the avatar of one of your sub-agents from an image file on your machine: absolute path, png / jpeg / webp / gif, max ${AVATAR_MAX_BYTES / 1024} KB (resize to 256 px first). The room shows it at once and sees a notice.`,
      inputSchema: OBJ({
        sub_agent_id: { type: 'integer', minimum: 1 },
        path: { type: 'string', minLength: 1, maxLength: PATH_MAX, description: 'Absolute path of the image file on your machine (~/ allowed)' },
      }, ['sub_agent_id', 'path']),
      annotations: WRITE,
      availableTo: mainSession,
      // The path is only handed to the agent's own stoa.js; the server stores bytes, never the path.
      call: async (ident, rawArgs) => {
        const args = argsOf(rawArgs);
        const id = posInt(args.sub_agent_id);
        if (!id) return asResult(fail(400, 'sub_agent_id required'));
        if (typeof args.path !== 'string' || !args.path || args.path.length > PATH_MAX) return asResult(fail(400, 'path required'));
        const denied = memory.subAgentAccess(id, ident.actorId);
        if (denied) return asResult(denied.status === 403 ? fail(404, 'sub-agent not found') : denied);
        const file = await readAgentImage(ident.actorId, args.path);
        if (file.error) return asResult(fail(file.status, file.error));
        const r = subAgents.setAvatar(id, Buffer.from(file.base64, 'base64'), { parentActorId: ident.actorId });
        if (r.status !== 200) return asResult(r);
        notice(ident, `set the avatar of sub-agent ${clean(r.body.sub_agent.label, 30)}`);
        return asResult(ok({ ok: true, avatar_url: r.body.avatar_url }));
      },
    },
    {
      name: 'sub_agent_delete',
      description: 'Delete one of your sub-agents, with its memory. Cannot be undone. The room sees a notice.',
      inputSchema: OBJ({ sub_agent_id: { type: 'integer', minimum: 1 } }, ['sub_agent_id']),
      annotations: DESTROY,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const id = posInt(args.sub_agent_id);
        if (!id) return fail(400, 'sub_agent_id required');
        const r = subAgents.remove(id, { parentActorId: ident.actorId });
        if (r.status !== 204) return r;
        notice(ident, `deleted sub-agent ${clean(r.sub_agent.label, 30)}`);
        return ok({ ok: true });
      }),
    },
    {
      name: 'sub_agent_trigger',
      description: 'Run one of your sub-agents linked to this room on a task (by label or id). Returns at once; its answer is posted in the thread and you are woken with it. Use this OR an @label in a message — never both for the same task.',
      inputSchema: OBJ({
        label: { type: 'string' }, sub_agent_id: { type: 'integer', minimum: 1 },
        task: { type: 'string', minLength: 10, description: 'Complete, self-contained instructions' },
        thread_id: THREAD_ARG, main_feed: MAIN_FEED_ARG,
      }, ['task']),
      annotations: WRITE,
      availableTo: mainSession,
      call: roomTool((ident, args) => {
        const t = threadFor(ident, args);
        if (t.err) return t.err;
        return subAgents.trigger(ident.roomId, ident.actorId, { ...pick(args, ['label', 'sub_agent_id', 'task']), thread_id: t.id });
      }),
    },

    // ── Skills ──
    {
      name: 'skill_list',
      description: 'List the skills in the Stoa library (shared by every agent): name, description, argument hint, creator, version. "yours": true = you created it and may change or delete it.',
      inputSchema: OBJ({}),
      annotations: READ,
      call: actorTool((ident) => skills.agentList(skillCaller(ident))),
    },
    {
      name: 'skill_get',
      description: `Read a skill without downloading it: its body (SKILL.md instructions) and file list, or with path one supporting text file (max ${TEXT_READ_MAX / 1024} KB). To follow a skill, use stoa__skill_use instead.`,
      inputSchema: OBJ({ name: SKILL_NAME, path: { type: 'string', minLength: 1, maxLength: 200, description: 'A supporting file of the skill; omit for the body' } }, ['name']),
      annotations: READ,
      // A whole text file of TEXT_READ_MAX bytes, escaped once in the tool's JSON and once more where the
      // gateway measures the result: quotes and backslashes take up to 4 bytes each.
      resultCapBytes: TEXT_READ_MAX * 4 + 64 * 1024,
      call: actorTool((ident, args) => skills.agentGet(args.name, args.path ?? null, skillCaller(ident))),
    },
    {
      name: 'skill_use',
      description: 'Load a skill to follow it now: returns its instructions (SKILL.md) and dir, the folder on your machine with its supporting files (read-only — write output to your workdir, not there). The same as the user invoking /name.',
      inputSchema: OBJ({ name: SKILL_NAME }, ['name']),
      annotations: READ,
      call: async (ident, rawArgs) => {
        const ref = skills.useRef(argsOf(rawArgs).name);
        if (!ref) return asResult(skillFail(404, 'not_found', 'Skill not found'));
        const out = { name: ref.name, version: ref.version, dir: null, body: ref.body };
        if (ref.file_count <= 1) return asResult(ok(out));
        const r = await syncAgentSkill(ident.actorId, { id: ref.id, name: ref.name, version: ref.version, manifest_hash: ref.manifest_hash });
        if (r.dir) {
          out.dir = r.dir;
          out.note = 'Supporting files are in dir (read-only: write output to your workdir, not there).';
          if (r.stale) out.note += ` The Stoa server could not be reached (${r.stale}); this is your cached copy, version ${r.version ?? '?'}, and may be out of date.`;
        } else {
          out.files_unavailable = r.unavailable || r.error;
          out.note = 'The instructions are complete, but the supporting files they mention are not on your machine; tell the user if a step needs them.';
        }
        return asResult(ok(out));
      },
    },
    {
      name: 'skill_create',
      description: `Create a skill in the Stoa library. It is active at once for every agent and the owner can see, edit or disable it. body = SKILL.md instructions without frontmatter; files = supporting files (text as content, binary as content_base64). At most ${MCP_SKILL_BYTES / 1048576} MB per call — for a bigger bundle, POST a zip to /api/skills/import with curl. You may later change or delete only skills you created. The room sees a notice.`,
      inputSchema: OBJ({ name: SKILL_NAME, ...SKILL_FIELDS, files: SKILL_FILES }, ['name', 'description', 'body']),
      annotations: WRITE,
      call: actorTool((ident, args) => {
        if (typeof args.body !== 'string') return skillFail(400, 'invalid_body', 'body must be a string');
        const f = skillFiles(args.files, 'files');
        if (f.err) return f.err;
        const big = tooBig(Buffer.byteLength(args.body) + f.bytes);
        if (big) return big;
        const r = skills.create({ ...pick(args, ['name', 'description', 'argument_hint', 'body', 'note']), files: f.files }, skillCaller(ident));
        if (r.status === 201) notice(ident, `created skill /${clean(r.body.skill.name, 48)}`);
        return skillShape(r);
      }),
    },
    {
      name: 'skill_update',
      description: 'Change a skill you created (as the parent agent: also one your sub-agents created). Send only what changes; each change is a new version and the old ones stay in its history. upsert_files adds or replaces files, delete_files removes paths. The room sees a notice.',
      inputSchema: OBJ({
        name: SKILL_NAME, ...SKILL_FIELDS,
        upsert_files: SKILL_FILES,
        delete_files: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 } },
      }, ['name']),
      annotations: WRITE,
      call: actorTool((ident, args) => {
        const patch = pick(args, ['description', 'argument_hint', 'body', 'delete_files', 'note']);
        const f = skillFiles(args.upsert_files, 'upsert_files');
        if (f.err) return f.err;
        if (f.files) patch.upsert_files = f.files;
        if (!Object.keys(patch).some(k => k !== 'note')) return skillFail(400, 'invalid_body', 'nothing to update');
        const big = tooBig((typeof args.body === 'string' ? Buffer.byteLength(args.body) : 0) + f.bytes);
        if (big) return big;
        const r = skillById(args.name, (id) => skills.update(id, patch, skillCaller(ident)));
        if (r.status === 200) notice(ident, `updated skill /${clean(r.body.skill.name, 48)}`);
        return skillShape(r);
      }),
    },
    {
      name: 'skill_delete',
      description: 'Delete a skill you created (as the parent agent: also one your sub-agents created), with its history. Cannot be undone. The room sees a notice.',
      inputSchema: OBJ({ name: SKILL_NAME }, ['name']),
      annotations: DESTROY,
      call: actorTool((ident, args) => {
        const r = skillById(args.name, (id) => skills.remove(id, skillCaller(ident)));
        if (r.status === 200) notice(ident, `deleted skill /${clean(args.name, 48)}`);
        return r;
      }),
    },

    // ── Automations ──
    {
      name: 'automation_list',
      description: 'List the automations (connector event → prompt in a room) that target rooms you are in.',
      inputSchema: OBJ({}),
      annotations: READ,
      call: actorTool((ident) => ok({ automations: automations.list(ident.actorId).body })),
    },
    {
      name: 'connection_list',
      description: 'List the connectors (Slack, email, WhatsApp…) an automation can listen to: id, name, provider, status.',
      inputSchema: OBJ({}),
      annotations: READ,
      call: actorTool(() => ok({ connections: automations.connections().body })),
    },
    {
      name: 'automation_create',
      description: 'Create an automation that posts prompt_template into a room when a connector event matches. Target room defaults to this session\'s room and must be one you are in. The target room sees a notice.',
      inputSchema: OBJ({ ...AUTO_FIELDS, target_room_id: { type: 'integer', minimum: 1, description: 'Defaults to this session\'s room' } }, ['name', 'trigger_event', 'prompt_template']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const data = pick(args, [...Object.keys(AUTO_FIELDS), 'target_room_id']);
        if (data.target_room_id === undefined) {
          if (ident.roomId == null) return fail(400, 'target_room_id required (this MCP session is not bound to a room)');
          data.target_room_id = ident.roomId;
        }
        return automations.create(ident.actorId, data);
      }),
    },
    {
      name: 'automation_update',
      description: 'Change an automation that targets one of your rooms. Send only the fields to change; enabled:false pauses it. The target room sees a notice.',
      inputSchema: OBJ({ automation_id: { type: 'integer', minimum: 1 }, ...AUTO_UPDATE_FIELDS, target_room_id: { type: 'integer', minimum: 1 } }, ['automation_id']),
      annotations: WRITE,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const id = posInt(args.automation_id);
        if (!id) return fail(400, 'automation_id required');
        return automations.update(ident.actorId, id, pick(args, [...Object.keys(AUTO_UPDATE_FIELDS), 'target_room_id']));
      }),
    },
    {
      name: 'automation_delete',
      description: 'Delete an automation that targets one of your rooms. Cannot be undone. The target room sees a notice.',
      inputSchema: OBJ({ automation_id: { type: 'integer', minimum: 1 } }, ['automation_id']),
      annotations: DESTROY,
      availableTo: mainSession,
      call: actorTool((ident, args) => {
        const id = posInt(args.automation_id);
        if (!id) return fail(400, 'automation_id required');
        return automations.remove(ident.actorId, id);
      }),
    },
  ];
  return tools;
}

module.exports = { stoaMcpTools };
