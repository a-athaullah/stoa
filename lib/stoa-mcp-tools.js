'use strict';
// Built-in MCP tools for Stoa's own features (served by lib/mcp-gateway.js as stoa__<name>): room
// messages, memories, system prompts, sub-agents and automations. Every tool calls the same core as
// its HTTP route (lib/room-messages.js, stoa-memory.js, system-prompts.js, sub-agents.js,
// automation-crud.js), so validation cannot drift between the two paths.
//
// Scope comes from the MCP token (ident) only, never from arguments — same rules as lib/agent-scope.js:
//   room tools      → ident.roomId, and the agent must be a participant of it
//   actor tools     → ident.actorId only
//   sub-agent tools → only sub-agents whose parent is ident.actorId (others resolve as "not found")
//   automations     → only automations targeting a room the agent is in
// A sub-agent session (ident.subAgentId set) may post, read, and read/write its OWN memory; tools that
// change configuration (sub-agent CRUD, system prompts, memories of the parent or the room,
// automations, triggering sub-agents) are hidden from it and refused (availableTo).
// Configuration changes post a " · config" notice in the session's room so the owner sees them.

const CONTENT_MAX = 4000;            // per message in read results; the full text stays in the room
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });
const asResult = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r.body ?? { ok: true }) }], ...(r.status >= 400 ? { isError: true } : {}) });
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const clamp = (v, def, max) => Math.min(posInt(v) ?? def, max);
const mainSession = (ident) => ident.subAgentId == null;

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

function stoaMcpTools({ db, broadcast, messages, memory, prompts, subAgents, automations, now = () => new Date() }) {
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
      description: 'Read the latest messages of this room\'s main feed (oldest first). Thread replies are summarized on their root unless include_thread_replies is true. Page back with before_id = the smallest id you got.',
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
