// ── Task board API ─────────────────────────────────────────────────────────
// Every HTTP call of the room task board goes through here (contract: stoa-feature/kanban/CONTRACT.md).
// Errors carry the HTTP status and the server's message so callers can show it as is.

class TasksApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TASKS_API_STATUS_TEXT = {
  400: 'The server rejected this change',
  403: 'You no longer have access to this room',
  404: 'This task no longer exists',
  409: 'This task changed in the meantime',
  423: 'This room is archived, tasks are read-only',
};

const TasksApi = {
  _id(n) {
    if (!Number.isInteger(n) || n <= 0) throw new TasksApiError(400, 'Invalid id');
    return String(n);
  },
  _base(roomId) { return `/api/rooms/${this._id(roomId)}/tasks`; },

  async _req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let r;
    try { r = await fetch(url, opts); } catch { throw new TasksApiError(0, 'Network error, try again'); }
    if (r.status === 401) { if (typeof showLogin === 'function') showLogin(); throw new TasksApiError(401, 'Session expired'); }
    if (r.status === 204) return null;
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) {
      const msg = data && typeof data.error === 'string' && data.error ? data.error : (TASKS_API_STATUS_TEXT[r.status] || `Request failed (${r.status})`);
      throw new TasksApiError(r.status, msg);
    }
    return data;
  },

  list(roomId) { return this._req('GET', this._base(roomId)); },
  get(roomId, taskId, { before, limit } = {}) {
    const q = new URLSearchParams();
    if (Number.isInteger(before)) q.set('before', String(before));
    if (Number.isInteger(limit)) q.set('limit', String(limit));
    const qs = q.toString();
    return this._req('GET', `${this._base(roomId)}/${this._id(taskId)}${qs ? '?' + qs : ''}`);
  },
  create(roomId, body) { return this._req('POST', this._base(roomId), body); },
  update(roomId, taskId, patch) { return this._req('PATCH', `${this._base(roomId)}/${this._id(taskId)}`, patch); },
  remove(roomId, taskId) { return this._req('DELETE', `${this._base(roomId)}/${this._id(taskId)}`); },
  move(roomId, taskId, body) { return this._req('POST', `${this._base(roomId)}/${this._id(taskId)}/move`, body); },
  retry(roomId, taskId) { return this._req('POST', `${this._base(roomId)}/${this._id(taskId)}/retry`, {}); },
  comment(roomId, taskId, text) { return this._req('POST', `${this._base(roomId)}/${this._id(taskId)}/comments`, { body: text }); },
  updateSettings(roomId, patch) { return this._req('PATCH', `${this._base(roomId)}/settings`, patch); },
  runner(roomId, action) {
    if (!['play', 'pause', 'stop'].includes(action)) throw new TasksApiError(400, 'Invalid runner action');
    return this._req('POST', `${this._base(roomId)}/runner/${action}`, {});
  },
};
