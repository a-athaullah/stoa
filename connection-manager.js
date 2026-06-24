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
    this.botName = null;
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
      this.botName = tokenType === 'bot' ? ('@' + info.user) : info.user;
    } catch (e) {
      console.error(`[conn:${this.connId}] auth.test failed:`, e.message);
      throw e;
    }

    this.client = new SocketModeClient({ appToken, logLevel: 'error' });

    const fwd = (eventType) => {
      this.client.on(eventType, ({ event, ack }) => {
        ack();
        if (!event) return;
        this.emit('slack_event', { eventType, event, webClient: this.webClient, connId: this.connId });
      });
    };

    // app_mention from Slack SDK — remap eventType to 'mention' to match DB/UI value
    this.client.on('app_mention', ({ event, ack }) => {
      ack();
      if (!event) return;
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

  async stop() {
    if (this.client) {
      try { await this.client.disconnect(); } catch {}
      this.client = null;
    }
    this.webClient = null;
    this.running = false;
    this.workspaceName = null;
    this.botName = null;
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

    this.emit('wa_event', {
      eventType: isGroup ? 'group_message' : 'message',
      msg, chatId, isGroup, sender, text, isMentioned,
      connId: this.connId,
    });
  }

  // Phase 3: send reply back to WhatsApp
  async sendMessage(chatId, text) {
    return this.sock.sendMessage(chatId, { text });
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

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this._conns = new Map(); // connId -> SlackConnection | WhatsAppConnection
  }

  // Start a connection from a DB row. Updates DB status via callback.
  async startConnection(conn, updateStatus) {
    if (conn.provider === 'whatsapp') {
      return this._startWhatsAppConnection(conn, updateStatus);
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
    } catch (e) {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', e.message, {});
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
    });
    wc.on('error', (err) => {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', err.message, meta);
    });

    // Store immediately so stopConnection/isRunning work before ready fires
    this._conns.set(conn.id, wc);
    // Start async — doesn't block (QR scan may be required)
    wc.start({ sessionDir }).catch((err) => {
      this._conns.delete(conn.id);
      updateStatus(conn.id, 'error', err.message, meta);
    });
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
}

module.exports = new ConnectionManager();
