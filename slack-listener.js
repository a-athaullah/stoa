// slack-listener.js — Slack Socket Mode manager for Stoa Automation
'use strict';

const EventEmitter = require('events');

class SlackListener extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.webClient = null;
    this.running = false;
    this.workspaceName = null;
    this.botName = null;
  }

  async start({ appToken, botToken }) {
    if (this.running) await this.stop();

    const { SocketModeClient } = require('@slack/socket-mode');
    const { WebClient } = require('@slack/web-api');

    this.webClient = new WebClient(botToken);

    try {
      const info = await this.webClient.auth.test();
      this.workspaceName = info.team;
      this.botName = '@' + info.user;
    } catch (e) {
      console.error('[slack] auth.test failed:', e.message);
      throw e;
    }

    this.client = new SocketModeClient({ appToken, logLevel: 'error' });

    // v2.x: event is passed directly, no ack needed (SDK handles it automatically)
    this.client.on('app_mention', (event) => {
      this.emit('slack_event', { eventType: 'mention', event, webClient: this.webClient });
    });

    this.client.on('message', (event) => {
      if (event.subtype) return;
      this.emit('slack_event', { eventType: 'message', event, webClient: this.webClient });
    });

    this.client.on('reaction_added', (event) => {
      this.emit('slack_event', { eventType: 'reaction', event, webClient: this.webClient });
    });

    this.client.on('error', (err) => {
      console.error('[slack] Socket Mode error:', err.message);
      this.emit('error', err);
    });

    this.client.on('disconnecting', () => {
      console.log('[slack] Socket Mode disconnecting');
    });

    await this.client.start();
    this.running = true;
    console.log(`[slack] Socket Mode connected — workspace: ${this.workspaceName}, bot: ${this.botName}`);
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
    console.log('[slack] Socket Mode stopped');
  }

  getStatus() {
    return {
      running: this.running,
      workspaceName: this.workspaceName,
      botName: this.botName,
    };
  }
}

module.exports = new SlackListener();
