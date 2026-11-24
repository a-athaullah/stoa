'use strict';
// Agent-side auto-compact loop guard. A compact that leaves the session file above the
// auto-compact threshold (typically a huge --append-system-prompt carried by every session)
// would be re-triggered after every run. Such a session key is paused for `cooldownMs`, so the
// caller reports once per window instead of once per run. Keys whose compact shrinks the
// session are never paused, and a later compact that shrinks the session clears the pause.
function createCompactGuard({ cooldownMs, now = Date.now }) {
  const paused = new Map(); // sessionKey -> { until, sizeBytes }
  return {
    isPaused(key) {
      const entry = paused.get(key);
      if (!entry) return false;
      if (now() >= entry.until) {
        paused.delete(key);
        return false;
      }
      return true;
    },
    // null = the compact brought the session under the threshold; otherwise the new pause entry.
    recordResult(key, sizeBytes, thresholdBytes) {
      if (!(sizeBytes > thresholdBytes)) {
        paused.delete(key);
        return null;
      }
      const entry = { until: now() + cooldownMs, sizeBytes };
      paused.set(key, entry);
      return entry;
    },
  };
}

module.exports = { createCompactGuard };
