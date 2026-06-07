// connection-manager.js — Multi-provider connection pool for Stoa Automation
// Replaces the singleton slack-listener.js with a keyed map of live connections.
'use strict';

const EventEmitter = require('events');

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

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this._conns = new Map(); // connId -> SlackConnection
  }

  // Start a connection from a DB row. Updates DB status via callback.
  async startConnection(conn, updateStatus) {
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
