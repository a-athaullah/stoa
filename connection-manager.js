// connection-manager.js — Multi-provider connection pool for Stoa Automation
// Replaces the singleton slack-listener.js with a keyed map of live connections.
'use strict';

const EventEmitter = require('events');
const path = require('path');

class SlackConnection extends EventEmitter {
  constructor(connId) {
    super();
    this.connId = connId;
    this.client = null;
    this.webClient = null;
    this.running = false;
    this.workspaceName = null;
    this.workspaceDomain = null;
    this.botName = null;
    this.botUserId = null;
  }

  async start({ appToken, token, tokenType }) {
    if (this.running) await this.stop();

    const { SocketModeClient } = require('@slack/socket-mode');
    const { WebClient } = require('@slack/web-api');

    if (!token) throw new Error('token is required');
    this.webClient = new WebClient(token);

    try {
      const info = await this.webClient.auth.test();
      this.workspaceName = info.team;
      // info.team is the display name (may contain spaces, e.g. "Qiscus Tech") —
      // unusable in URLs. info.url carries the real subdomain (https://qiscustech.slack.com/).
      try { this.workspaceDomain = new URL(info.url).hostname.split('.')[0]; } catch { this.workspaceDomain = null; }
      this.botName = tokenType === 'bot' ? ('@' + info.user) : info.user;
      this.botUserId = info.user_id || null;
    } catch (e) {
      console.error(`[conn:${this.connId}] auth.test failed:`, e.message);
      throw e;
    }

    this.client = new SocketModeClient({ appToken, logLevel: 'error' });

    const fwd = (eventType) => {
      this.client.on(eventType, ({ event, ack }) => {
        ack();
        if (!event) return;
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
        console.log(`[${ts}] [slack:recv] type=${eventType} channel=${event.channel || event.item?.channel || '-'} ts=${event.ts || event.event_ts || '-'}`);
        this.emit('slack_event', { eventType, event, webClient: this.webClient, connId: this.connId });
      });
    };

    // app_mention from Slack SDK — remap eventType to 'mention' to match DB/UI value
    this.client.on('app_mention', ({ event, ack }) => {
      ack();
      if (!event) return;
      const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
      console.log(`[${ts}] [slack:recv] type=mention channel=${event.channel || '-'} ts=${event.ts || '-'}`);
      this.emit('slack_event', { eventType: 'mention', event, webClient: this.webClient, connId: this.connId });
    });
    fwd('message');
    fwd('reaction_added');

    this.client.on('error', (err) => {
      console.error(`[conn:${this.connId}] Socket Mode error:`, err.message);
      this.emit('error', err);
    });

    await this.client.start();
    this.running = true;
    console.log(`[conn:${this.connId}] connected — workspace: ${this.workspaceName}, handle: ${this.botName}`);
  }

  async sendMessage(channelId, text) {
    if (!this.webClient) throw new Error('not connected');
    return this.webClient.chat.postMessage({ channel: channelId, text });
  }

  async getHistory(channelId, limit) {
    if (!this.webClient) throw new Error('not connected');
    return this.webClient.conversations.history({ channel: channelId, limit: limit || 50 });
  }

  async stop() {
    if (this.client) {
      try { await this.client.disconnect(); } catch {}
      this.client = null;
    }
    this.webClient = null;
    this.running = false;
    this.workspaceName = null;
    this.workspaceDomain = null;
    this.botName = null;
    this.botUserId = null;
    console.log(`[conn:${this.connId}] stopped`);
  }

  getStatus() {
    return { running: this.running, workspaceName: this.workspaceName, botName: this.botName };
  }
}

class WhatsAppConnection extends EventEmitter {
  constructor(connId) {
    super();
    this.connId = connId;
    this.sock = null;
    this.running = false;
    this.botJid = null;
    this._processed = new Map(); // messageId → expiresAt, for dedup after reconnect
  }

  async start({ sessionDir }) {
    const {
      makeWASocket, useMultiFileAuthState, DisconnectReason,
    } = require('@whiskeysockets/baileys');
    const pino = require('pino');

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger: pino({ level: 'silent' }),
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log(`[wa:${this.connId}] QR received — scan with WhatsApp to authenticate`);
        this.emit('qr', qr);
      }
      if (connection === 'open') {
        this.running = true;
        this.botJid = this.sock.user?.id || null;
        console.log(`[wa:${this.connId}] connected — jid: ${this.botJid}`);
        this.emit('ready');
      }
      if (connection === 'close') {
        this.running = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden) {
          console.log(`[wa:${this.connId}] logged out — session cleared`);
          this.emit('error', new Error('logged_out'));
        } else {
          console.log(`[wa:${this.connId}] disconnected (${statusCode}), reconnecting in 5s...`);
          setTimeout(() => this.start({ sessionDir }).catch(() => {}), 5000);
        }
      }
    });

    this.sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return; // skip history sync on connect
      for (const msg of messages) {
        this._handleMessage(msg);
      }
    });
  }

  _handleMessage(msg) {
    if (msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;
    if (msg.message?.protocolMessage) return;
    if (msg.message?.reactionMessage) return;
    if (msg.messageStubType) return;

    // Dedup: prevent double-trigger after reconnect re-delivery
    const now = Date.now();
    const dedupKey = msg.key.id;
    if (this._processed.has(dedupKey)) return;
    this._processed.set(dedupKey, now + 120_000);
    if (this._processed.size > 500) {
      for (const [k, exp] of this._processed) { if (exp < now) this._processed.delete(k); }
    }

    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : chatId;
    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || '';
    if (!text.trim()) return; // skip media-only messages without caption

    const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const botBase = this.botJid ? this.botJid.split(':')[0] : null;
    const isMentioned = botBase
      ? mentionedJids.some(jid => jid === this.botJid || jid.startsWith(botBase))
      : false;

    // Detect media type and size for storage
    let mediaType = null;
    let mediaSizeBytes = 0;
    const imgMsg  = msg.message?.imageMessage;
    const audMsg  = msg.message?.audioMessage;
    const vidMsg  = msg.message?.videoMessage;
    const docMsg  = msg.message?.documentMessage;
    if (imgMsg)  { mediaType = 'image';    mediaSizeBytes = Number(imgMsg.fileLength  || 0); }
    else if (audMsg) { mediaType = 'audio'; mediaSizeBytes = Number(audMsg.fileLength || 0); }
    else if (vidMsg) { mediaType = 'video'; mediaSizeBytes = Number(vidMsg.fileLength || 0); }
    else if (docMsg) { mediaType = 'document'; mediaSizeBytes = Number(docMsg.fileLength || 0); }

    this.emit('wa_event', {
      eventType: isGroup ? 'group_message' : 'message',
      msg, chatId, isGroup, sender, senderName: msg.pushName || sender, text, isMentioned,
      mediaType, mediaSizeBytes,
      connId: this.connId,
    });
  }

  async sendMessage(chatId, text) {
    if (!this.sock) throw new Error('not connected');
    return this.sock.sendMessage(chatId, { text });
  }

  async downloadMedia(msg) {
    if (!this.sock) throw new Error('not connected');
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    return downloadMediaMessage(msg, 'buffer', {}, { logger: require('pino')({ level: 'silent' }) });
  }

  async stop() {
    if (this.sock) {
      try { await this.sock.end(); } catch {}
      this.sock = null;
    }
    this.running = false;
    this.botJid = null;
    console.log(`[wa:${this.connId}] stopped`);
  }

  getStatus() {
    return { running: this.running, botJid: this.botJid };
  }
}

class EmailConnection extends EventEmitter {
  constructor(connId) {
    super();
    this.connId = connId;
    this.client = null;
    this.running = false;
    this._stopRequested = false;
    this._idleTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._rateBucket = { count: 0, resetAt: 0 };
  }

  async start({ host, port, secure, user, password, folder, allowedSenders, requireAuthPass, lastUid, uidValidity }) {
    if (this.running) await this.stop();
    this._stopRequested = false;

    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');

    this._folder = folder || 'INBOX';
    this._allowedSenders = (allowedSenders || []).map(s => s.toLowerCase().trim()).filter(Boolean);
    this._requireAuthPass = requireAuthPass !== false;
    this._lastUid = lastUid || 0;
    this._uidValidity = uidValidity || 0;
    this._simpleParser = simpleParser;

    if (!this._allowedSenders.length) throw new Error('allowedSenders is required (at least one address)');

    this.client = new ImapFlow({
      host, port: port || 993, secure: secure !== false,
      auth: { user, pass: password },
      logger: false,
      emitLogs: false,
      tls: { rejectUnauthorized: true },
    });

    this.client.on('error', (err) => {
      console.error(`[email:${this.connId}] error:`, err.message);
      if (/AUTHENTICATIONFAILED|auth|login/i.test(err.message)) {
        this.emit('auth_error', err);
      } else {
        this.emit('error', err);
      }
    });

    this.client.on('close', () => {
      this.running = false;
      if (!this._stopRequested) {
        this._scheduleReconnect({ host, port, secure, user, password, folder, allowedSenders, requireAuthPass, lastUid: this._lastUid, uidValidity: this._uidValidity });
      }
    });

    try {
      await this.client.connect();
    } catch (e) {
      this.running = false;
      if (/AUTHENTICATIONFAILED|auth|login/i.test(e.message)) {
        this.emit('auth_error', e);
        throw e;
      }
      throw e;
    }

    this.running = true;
    this._reconnectAttempt = 0;

    const lock = await this.client.getMailboxLock(this._folder);
    try {
      const mbStatus = this.client.mailbox;
      if (this._uidValidity && mbStatus.uidValidity !== this._uidValidity) {
        console.log(`[email:${this.connId}] uidValidity changed (${this._uidValidity} → ${mbStatus.uidValidity}), resetting to now`);
        this._lastUid = mbStatus.uidNext ? mbStatus.uidNext - 1 : 0;
        this._uidValidity = mbStatus.uidValidity;
      } else if (!this._lastUid) {
        this._lastUid = mbStatus.uidNext ? mbStatus.uidNext - 1 : 0;
        this._uidValidity = mbStatus.uidValidity;
        console.log(`[email:${this.connId}] first connect — starting from UID ${this._lastUid}`);
      }
    } finally {
      lock.release();
    }

    this.emit('metadata_update', { lastUid: this._lastUid, uidValidity: this._uidValidity });

    this._startIdleLoop();
  }

  _startIdleLoop() {
    if (this._stopRequested || !this.client) return;

    const RE_IDLE_MS = 24 * 60 * 1000; // 24 min, before Gmail's ~29 min cutoff

    const doIdle = async () => {
      if (this._stopRequested || !this.client) return;
      try {
        const lock = await this.client.getMailboxLock(this._folder);
        try {
          await this._fetchNew();
        } finally {
          lock.release();
        }

        if (this._stopRequested) return;

        // IDLE with timeout for re-IDLE
        await this.client.idle({ timeout: RE_IDLE_MS });

        // After IDLE breaks (new mail or timeout), fetch new messages
        if (this._stopRequested) return;
        const lock2 = await this.client.getMailboxLock(this._folder);
        try {
          await this._fetchNew();
        } finally {
          lock2.release();
        }
      } catch (e) {
        if (this._stopRequested) return;
        console.error(`[email:${this.connId}] idle loop error:`, e.message);
      }
      // Re-enter idle loop
      if (!this._stopRequested && this.running) {
        this._idleTimer = setTimeout(() => doIdle(), 1000);
      }
    };

    doIdle();
  }

  async _fetchNew() {
    const range = `${this._lastUid + 1}:*`;
    let messages;
    try {
      messages = [];
      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
        headers: ['authentication-results'],
      })) {
        messages.push(msg);
      }
    } catch (e) {
      if (/Nothing to fetch/i.test(e.message) || /No matching messages/i.test(e.message)) return;
      throw e;
    }

    for (const msg of messages) {
      if (msg.uid <= this._lastUid) continue;

      // Rate limit: max 30 emails per minute
      const now = Date.now();
      if (now > this._rateBucket.resetAt) {
        this._rateBucket = { count: 0, resetAt: now + 60_000 };
      }
      if (this._rateBucket.count >= 30) {
        console.warn(`[email:${this.connId}] rate limit hit, skipping UID ${msg.uid}`);
        continue;
      }
      this._rateBucket.count++;

      try {
        await this._processMessage(msg);
      } catch (e) {
        console.error(`[email:${this.connId}] process UID ${msg.uid} failed:`, e.message);
      }
      this._lastUid = msg.uid;
      this.emit('metadata_update', { lastUid: this._lastUid, uidValidity: this._uidValidity });
    }
  }

  async _processMessage(msg) {
    const parsed = await this._simpleParser(msg.source);

    const from = (parsed.from?.value?.[0]?.address || '').toLowerCase();
    const fromName = parsed.from?.value?.[0]?.name || '';
    if (!from) return;

    // Allowlist check (exact match or wildcard domain)
    const allowed = this._allowedSenders.some(pattern => {
      if (pattern.startsWith('*@')) {
        const domain = pattern.slice(2);
        return from.endsWith('@' + domain);
      }
      return from === pattern;
    });
    if (!allowed) return;

    // Authentication-Results check
    if (this._requireAuthPass) {
      const authHeader = (parsed.headers?.get('authentication-results') || '').toString();
      if (!this._checkAuthResults(authHeader)) {
        console.warn(`[email:${this.connId}] rejected UID ${msg.uid} from ${from}: auth check failed`);
        return;
      }
    }

    // Sanitize body: prefer text, fallback to stripped HTML
    let text = parsed.text || '';
    if (!text && parsed.html) {
      text = parsed.html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }
    // Strip control characters
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    // Truncate to 8KB
    const MAX_BODY = 8192;
    if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY) + ' [truncated]';

    const hasAttachments = (parsed.attachments?.length || 0) > 0;

    this.emit('email_event', {
      eventType: 'message',
      connId: this.connId,
      uid: msg.uid,
      messageId: parsed.messageId || '',
      from,
      fromName,
      to: (parsed.to?.value || []).map(v => v.address).join(', '),
      subject: (parsed.subject || '').slice(0, 500),
      date: (parsed.date || new Date()).toISOString(),
      text,
      hasAttachments,
      attachmentCount: parsed.attachments?.length || 0,
    });
  }

  _checkAuthResults(header) {
    if (!header) return false;
    // dmarc=pass is ideal
    if (/dmarc\s*=\s*pass/i.test(header)) return true;
    // fallback: dkim=pass with aligned domain
    if (/dkim\s*=\s*pass/i.test(header)) return true;
    return false;
  }

  _scheduleReconnect(opts) {
    if (this._stopRequested) return;
    this._reconnectAttempt++;
    const base = Math.min(5000 * Math.pow(2, this._reconnectAttempt - 1), 300_000);
    const jitter = Math.random() * base * 0.3;
    const delay = base + jitter;
    console.log(`[email:${this.connId}] reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(async () => {
      if (this._stopRequested) return;
      try {
        await this.start(opts);
        this.emit('reconnected');
      } catch (e) {
        if (/AUTHENTICATIONFAILED|auth|login/i.test(e.message)) {
          console.error(`[email:${this.connId}] auth failed, stopping retry`);
          return;
        }
        // Will trigger 'close' → _scheduleReconnect again
      }
    }, delay);
  }

  async stop() {
    this._stopRequested = true;
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.client) {
      try { await this.client.logout(); } catch {}
      this.client = null;
    }
    this.running = false;
    console.log(`[email:${this.connId}] stopped`);
  }

  getStatus() {
    return { running: this.running };
  }
}

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this._conns = new Map(); // connId -> SlackConnection | WhatsAppConnection | EmailConnection
  }

  // Start a connection from a DB row. Updates DB status via callback.
  async startConnection(conn, updateStatus) {
    if (conn.provider === 'whatsapp') {
      return this._startWhatsAppConnection(conn, updateStatus);
    }
    if (conn.provider === 'email') {
      return this._startEmailConnection(conn, updateStatus);
    }
    return this._startSlackConnection(conn, updateStatus);
  }

  async _startSlackConnection(conn, updateStatus) {
    let creds = {};
    try { creds = JSON.parse(conn.credentials || '{}'); } catch {}

    const existing = this._conns.get(conn.id);
    if (existing) await existing.stop();

    const sc = new SlackConnection(conn.id);
    sc.on('slack_event', (payload) => this.emit('slack_event', payload));
    sc.on('error', () => {});

    try {
      await sc.start({
        appToken:  creds.appToken,
        token:     creds.token,
        tokenType: conn.token_type,
      });
      this._conns.set(conn.id, sc);
      const { workspaceName, botName } = sc.getStatus();
      updateStatus(conn.id, 'connected', null, { workspaceName, botName });
      this.emit('conn_status', { connId: conn.id, status: 'connected' });
    } catch (e) {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', e.message, {});
      this.emit('conn_status', { connId: conn.id, status: 'error', error: e.message });
      throw e;
    }
  }

  async _startWhatsAppConnection(conn, updateStatus) {
    let meta = {};
    try { meta = JSON.parse(conn.metadata || '{}'); } catch {}
    const safeDefault = path.join(__dirname, '.wa-sessions', String(conn.id));
    const resolved = meta.sessionDir ? path.resolve(__dirname, meta.sessionDir) : safeDefault;
    // Guard: session dir must stay within project directory
    const sessionDir = resolved.startsWith(__dirname + path.sep) || resolved === __dirname
      ? resolved
      : safeDefault;

    const existing = this._conns.get(conn.id);
    if (existing) await existing.stop();

    const wc = new WhatsAppConnection(conn.id);
    wc.on('wa_event', (payload) => this.emit('wa_event', payload));
    wc.on('qr', (qr) => this.emit('wa_qr', { connId: conn.id, qr }));
    wc.on('ready', () => {
      updateStatus(conn.id, 'connected', null, { ...meta, sessionDir: meta.sessionDir || `.wa-sessions/${conn.id}` });
      this.emit('conn_status', { connId: conn.id, status: 'connected' });
    });
    wc.on('error', (err) => {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', err.message, meta);
      this.emit('conn_status', { connId: conn.id, status: 'error', error: err.message });
    });

    // Store immediately so stopConnection/isRunning work before ready fires
    this._conns.set(conn.id, wc);
    // Start async — doesn't block (QR scan may be required)
    wc.start({ sessionDir }).catch((err) => {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', err.message, meta);
    });
  }

  async _startEmailConnection(conn, updateStatus) {
    let creds = {};
    try { creds = JSON.parse(conn.credentials || '{}'); } catch {}
    let meta = {};
    try { meta = JSON.parse(conn.metadata || '{}'); } catch {}

    // Decrypt password if encrypted
    let password = creds.password || '';
    try {
      const { isEncrypted, decrypt } = require('./lib/credentials');
      if (isEncrypted(password)) password = decrypt(password);
    } catch {}

    if (!creds.user || !password) {
      updateStatus(conn.id, 'error', 'user and password required', meta);
      throw new Error('user and password required');
    }

    // Validate host to prevent SSRF
    const host = (meta.host || '').trim();
    if (!host || /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1|\[::1\]|0\.0\.0\.0)/i.test(host)) {
      updateStatus(conn.id, 'error', 'Invalid or private host', meta);
      throw new Error('Invalid or private host');
    }

    const existing = this._conns.get(conn.id);
    if (existing) await existing.stop();

    const ec = new EmailConnection(conn.id);
    ec.on('email_event', (payload) => this.emit('email_event', payload));
    ec.on('metadata_update', (update) => {
      const freshMeta = { ...meta, ...update };
      updateStatus(conn.id, 'connected', null, freshMeta);
      meta = freshMeta;
    });
    ec.on('auth_error', (err) => {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', 'Authentication failed: ' + err.message, meta);
      this.emit('conn_status', { connId: conn.id, status: 'error', error: 'Authentication failed' });
    });
    ec.on('error', (err) => {
      this.emit('conn_status', { connId: conn.id, status: 'error', error: err.message });
    });
    ec.on('reconnected', () => {
      this.emit('conn_status', { connId: conn.id, status: 'connected' });
    });

    this._conns.set(conn.id, ec);
    try {
      await ec.start({
        host,
        port: meta.port || 993,
        secure: meta.secure !== false,
        user: creds.user,
        password,
        folder: meta.folder || 'INBOX',
        allowedSenders: meta.allowedSenders || [],
        requireAuthPass: meta.requireAuthPass !== false,
        lastUid: meta.lastUid || 0,
        uidValidity: meta.uidValidity || 0,
      });
      updateStatus(conn.id, 'connected', null, meta);
      this.emit('conn_status', { connId: conn.id, status: 'connected' });
    } catch (e) {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', e.message, meta);
      this.emit('conn_status', { connId: conn.id, status: 'error', error: e.message });
      throw e;
    }
  }

  async stopConnection(connId) {
    const sc = this._conns.get(connId);
    if (sc) {
      await sc.stop();
      this._conns.delete(connId);
    }
  }

  getStatus(connId) {
    const sc = this._conns.get(connId);
    if (!sc) return { running: false };
    return sc.getStatus();
  }

  isRunning(connId) {
    return this._conns.get(connId)?.running === true;
  }

  // Return list of running connections with their provider
  listRunning() {
    const result = [];
    for (const [connId, conn] of this._conns) {
      if (conn.running) {
        const provider = conn instanceof EmailConnection ? 'email' : conn instanceof WhatsAppConnection ? 'whatsapp' : 'slack';
        result.push({ connId, provider });
      }
    }
    return result;
  }

  // Send a message via connector — routes by provider
  async connectorSend(connId, chatId, text) {
    const conn = this._conns.get(connId);
    if (!conn) throw new Error(`connector ${connId} not found`);
    if (!conn.running) throw new Error(`connector ${connId} not connected`);
    return conn.sendMessage(chatId, text);
  }

  // Download WA media via connector
  async downloadWaMedia(connId, msg) {
    const conn = this._conns.get(connId);
    if (!conn || !(conn instanceof WhatsAppConnection)) return null;
    return conn.downloadMedia(msg);
  }

  // Get Slack connection for history reads
  getSlackConnection(connId) {
    const conn = this._conns.get(connId);
    if (!conn || !(conn instanceof SlackConnection)) return null;
    return conn;
  }
}

module.exports = new ConnectionManager();
