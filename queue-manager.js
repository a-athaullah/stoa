'use strict';

const EventEmitter = require('events');

class QueueManager extends EventEmitter {
  constructor() {
    super();
    this._queues = new Map();
    this._running = new Map();
    this._stats = { totalQueued: 0, totalProcessed: 0 };
  }

  enqueue(key, asyncFn, meta = {}) {
    if (!this._queues.has(key)) this._queues.set(key, []);

    return new Promise((resolve, reject) => {
      this._queues.get(key).push({ fn: asyncFn, meta, resolve, reject });
      this._stats.totalQueued++;

      const pending = this._queues.get(key).length;
      this.emit('enqueued', { key, pending, meta });

      this._drain(key);
    });
  }

  async _drain(key) {
    if (this._running.get(key)) return;
    this._running.set(key, true);

    const queue = this._queues.get(key);
    while (queue && queue.length > 0) {
      const { fn, meta, resolve, reject } = queue.shift();
      this.emit('processing', { key, pending: queue.length, meta });

      try {
        const result = await fn();
        this.emit('completed', { key, pending: queue.length, meta });
        this._stats.totalProcessed++;
        resolve(result);
      } catch (e) {
        this.emit('error', { key, error: e, pending: queue.length, meta });
        this._stats.totalProcessed++;
        reject(e);
      }
    }

    this._running.delete(key);
    this._queues.delete(key);
    this.emit('drained', { key });
  }

  pending(key) {
    return this._queues.get(key)?.length || 0;
  }

  busy(key) {
    return this._running.has(key);
  }

  stats() {
    const activeRooms = [];
    for (const [key, q] of this._queues) {
      activeRooms.push({ room: key, pending: q.length, processing: this._running.has(key) });
    }
    return { ...this._stats, activeRooms };
  }
}

module.exports = new QueueManager();
