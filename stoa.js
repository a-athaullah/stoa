#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// lib/thinking-sanitizer.js
var require_thinking_sanitizer = __commonJS({
  "lib/thinking-sanitizer.js"(exports2, module2) {
    "use strict";
    var THINKING_TYPES = /* @__PURE__ */ new Set(["thinking", "redacted_thinking"]);
    var THINKING_MARKER_RE2 = /^\s*(?:\[thinking\]\s*)+/;
    function stripLeadingThinkingMarker2(text) {
      return typeof text === "string" ? text.replace(THINKING_MARKER_RE2, "") : text;
    }
    function isThinkingSignatureError2(text = "") {
      if (!text || text.length > 600) return false;
      const lower = text.toLowerCase();
      return lower.includes("thinking") && (lower.includes("signature") || lower.includes("cannot be modified") || lower.includes("must remain as they were"));
    }
    function matchThinkingBlock2(b, { stripAll = false } = {}) {
      if (!b || typeof b !== "object") return false;
      if (THINKING_TYPES.has(b.type)) {
        if (stripAll) return true;
        if (b.type === "thinking" && !b.signature) return true;
        if (b.type === "redacted_thinking" && !b.data) return true;
        if (b.cache_control) return true;
        return false;
      }
      if (b.type === "text" && typeof b.text === "string" && THINKING_MARKER_RE2.test(b.text)) return true;
      return false;
    }
    function replaceThinkingBlock2(b, { stripAll = false } = {}) {
      if (THINKING_TYPES.has(b.type)) {
        if (stripAll) return null;
        const unsigned = b.type === "thinking" && !b.signature || b.type === "redacted_thinking" && !b.data;
        if (unsigned) return null;
        if (b.cache_control) {
          const { cache_control, ...rest } = b;
          return rest;
        }
        return null;
      }
      const cleaned = stripLeadingThinkingMarker2(b.text);
      return cleaned ? { ...b, text: cleaned } : null;
    }
    module2.exports = {
      THINKING_TYPES,
      THINKING_MARKER_RE: THINKING_MARKER_RE2,
      stripLeadingThinkingMarker: stripLeadingThinkingMarker2,
      isThinkingSignatureError: isThinkingSignatureError2,
      matchThinkingBlock: matchThinkingBlock2,
      replaceThinkingBlock: replaceThinkingBlock2
    };
  }
});

// lib/transcript-sanitizer.js
var require_transcript_sanitizer = __commonJS({
  "lib/transcript-sanitizer.js"(exports2, module2) {
    "use strict";
    var PLACEHOLDER_TEXT = "(content elided)";
    var STUB_RESULT_TEXT = "(result unavailable)";
    function findAnomalies2(entries) {
      const toolUseIds = /* @__PURE__ */ new Map();
      const toolResultIds = /* @__PURE__ */ new Map();
      const anomalies = { orphanResults: [], missingResults: [], duplicateIds: [], emptyTurns: [] };
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || typeof entry !== "object") continue;
        const content = entry.content;
        if (!Array.isArray(content) || content.length === 0) {
          if (entry.role === "assistant" || entry.role === "user") {
            anomalies.emptyTurns.push(i);
          }
          continue;
        }
        for (let j = 0; j < content.length; j++) {
          const block = content[j];
          if (!block || typeof block !== "object") continue;
          if (block.type === "tool_use" && block.id) {
            if (toolUseIds.has(block.id)) {
              anomalies.duplicateIds.push({ entryIdx: i, blockIdx: j, id: block.id, firstEntry: toolUseIds.get(block.id).entryIdx });
            } else {
              toolUseIds.set(block.id, { entryIdx: i, blockIdx: j });
            }
          }
          if (block.type === "tool_result" && block.tool_use_id) {
            toolResultIds.set(block.tool_use_id, { entryIdx: i, blockIdx: j });
          }
        }
      }
      for (const [id, loc] of toolUseIds) {
        if (!toolResultIds.has(id)) {
          anomalies.missingResults.push({ id, entryIdx: loc.entryIdx });
        }
      }
      for (const [id, loc] of toolResultIds) {
        if (!toolUseIds.has(id)) {
          anomalies.orphanResults.push({ id, entryIdx: loc.entryIdx, blockIdx: loc.blockIdx });
        }
      }
      return anomalies;
    }
    function hasAnomalies2(anomalies) {
      return anomalies.orphanResults.length > 0 || anomalies.missingResults.length > 0 || anomalies.duplicateIds.length > 0 || anomalies.emptyTurns.length > 0;
    }
    function anomalyCount(anomalies) {
      return anomalies.orphanResults.length + anomalies.missingResults.length + anomalies.duplicateIds.length + anomalies.emptyTurns.length;
    }
    function fixAnomalies2(entries, anomalies) {
      let fixed = 0;
      for (const dup of anomalies.duplicateIds) {
        const entry = entries[dup.entryIdx];
        if (!entry?.content?.[dup.blockIdx]) continue;
        const block = entry.content[dup.blockIdx];
        const newId = block.id + "-dup-" + dup.blockIdx;
        block.id = newId;
        for (const e of entries) {
          if (!Array.isArray(e?.content)) continue;
          for (const b of e.content) {
            if (b?.type === "tool_result" && b.tool_use_id === dup.id) {
              const useEntry = entries[dup.firstEntry];
              const origStillExists = useEntry?.content?.some((bl) => bl?.type === "tool_use" && bl.id === dup.id);
              if (origStillExists) {
                b.tool_use_id = newId;
                break;
              }
            }
          }
        }
        fixed++;
      }
      const orphanBlocksToRemove = /* @__PURE__ */ new Map();
      for (const orphan of anomalies.orphanResults) {
        if (!orphanBlocksToRemove.has(orphan.entryIdx)) {
          orphanBlocksToRemove.set(orphan.entryIdx, /* @__PURE__ */ new Set());
        }
        orphanBlocksToRemove.get(orphan.entryIdx).add(orphan.blockIdx);
        fixed++;
      }
      for (const [entryIdx, blockIdxs] of orphanBlocksToRemove) {
        const entry = entries[entryIdx];
        if (!Array.isArray(entry?.content)) continue;
        entry.content = entry.content.filter((_, idx) => !blockIdxs.has(idx));
      }
      for (const missing of anomalies.missingResults) {
        let targetIdx = missing.entryIdx + 1;
        while (targetIdx < entries.length && entries[targetIdx]?.role === "assistant") {
          targetIdx++;
        }
        if (targetIdx < entries.length && entries[targetIdx]?.role === "user") {
          if (!Array.isArray(entries[targetIdx].content)) {
            entries[targetIdx].content = [];
          }
          entries[targetIdx].content.push({
            type: "tool_result",
            tool_use_id: missing.id,
            content: STUB_RESULT_TEXT
          });
        } else {
          entries.splice(targetIdx, 0, {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: missing.id,
              content: STUB_RESULT_TEXT
            }]
          });
        }
        fixed++;
      }
      for (const emptyIdx of anomalies.emptyTurns) {
        const entry = entries[emptyIdx];
        if (!entry) continue;
        if (!Array.isArray(entry.content) || entry.content.length === 0) {
          entry.content = [{ type: "text", text: PLACEHOLDER_TEXT }];
          fixed++;
        }
      }
      for (const [entryIdx] of orphanBlocksToRemove) {
        const entry = entries[entryIdx];
        if (entry && Array.isArray(entry.content) && entry.content.length === 0) {
          entry.content = [{ type: "text", text: PLACEHOLDER_TEXT }];
        }
      }
      return fixed;
    }
    function escalationLevel2(anomalies) {
      const total = anomalyCount(anomalies);
      if (total === 0) return "none";
      const hasEmptyTurns = anomalies.emptyTurns.length > 0;
      if (total > 5 || hasEmptyTurns) return "error";
      if (total > 2 || anomalies.missingResults.length > 1) return "warning";
      return "info";
    }
    function formatNotice2(anomalies, fixed) {
      const parts = [];
      if (anomalies.orphanResults.length) parts.push(`${anomalies.orphanResults.length} orphan tool_result dropped`);
      if (anomalies.missingResults.length) parts.push(`${anomalies.missingResults.length} missing tool_result stubbed`);
      if (anomalies.duplicateIds.length) parts.push(`${anomalies.duplicateIds.length} duplicate ID renamed`);
      if (anomalies.emptyTurns.length) parts.push(`${anomalies.emptyTurns.length} empty turn filled`);
      return `transcript: fixed ${fixed} anomalies (${parts.join(", ")})`;
    }
    module2.exports = {
      PLACEHOLDER_TEXT,
      STUB_RESULT_TEXT,
      findAnomalies: findAnomalies2,
      hasAnomalies: hasAnomalies2,
      anomalyCount,
      fixAnomalies: fixAnomalies2,
      escalationLevel: escalationLevel2,
      formatNotice: formatNotice2
    };
  }
});

// stoa.js
var CLIENT_VERSION = "0.4.456";
var WebSocket = require("ws");
var readline = require("readline");
var fs = require("fs");
var crypto = require("crypto");
var path = require("path");
var os = require("os");
var { spawnSync } = require("child_process");
var { ClaudeSession } = require("./claude-session");
var { stripLeadingThinkingMarker, isThinkingSignatureError, matchThinkingBlock, replaceThinkingBlock, THINKING_MARKER_RE } = require_thinking_sanitizer();
var { findAnomalies, hasAnomalies, fixAnomalies, escalationLevel, formatNotice } = require_transcript_sanitizer();
var STOA_URL = process.env.STOA_URL || "ws://localhost:3001";
var ACTOR_ID = parseInt(process.env.STOA_ACTOR_ID || "1");
var ACTOR_TYPE = process.env.STOA_TYPE || "human";
var STOA_SECRET = process.env.STOA_SECRET || "";
// PM2 logs carry no timestamp of their own; without one, agent log lines cannot be matched to
// message rows. Agent process only — the human chat CLI and in-process importers (test.js) keep
// the plain console.
if (require.main === module && ACTOR_TYPE === "ai") {
  for (const level of ["log", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => orig(new Date().toISOString(), ...args);
  }
}
var { readCfAccessEnv, cfHeadersFor, httpOrigin, startCfForwardProxy } = require("./lib/cf-access");
var { detectSupervisor } = require("./lib/supervisor");
var { readAvatarFile } = require("./lib/avatar-image");
var SUPERVISOR = detectSupervisor();
var BOOT_ID = crypto.randomBytes(8).toString("hex");
var CF_ACCESS = readCfAccessEnv(process.env, (m) => console.warn(m));
delete process.env.STOA_CF_ACCESS_CLIENT_ID;
delete process.env.STOA_CF_ACCESS_CLIENT_SECRET;
var cfProxyReady = null;
function stoaCfHeaders(url) {
  return cfHeadersFor(url, STOA_URL, CF_ACCESS);
}
var ROOM_ID = parseInt(process.argv[2] || process.env.STOA_ROOM_ID || "1");
var C = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  white: "\x1B[97m",
  blue: "\x1B[94m",
  cyan: "\x1B[96m",
  yellow: "\x1B[93m",
  red: "\x1B[91m",
  gray: "\x1B[90m"
};
function colorFromHex(hex = "") {
  if (hex.toLowerCase().includes("4d9f")) return C.blue;
  if (hex.toLowerCase().includes("00d4")) return C.cyan;
  return C.white;
}
var ws = null;
var reconnectTimer = null;
var rl = null;
var activeStreams = {};
var triggerQueue = [];
var activeTriggers = /* @__PURE__ */ new Map();
var pendingRequests = /* @__PURE__ */ new Map();
var requestIdCounter = 0;
var pendingRestart = false;
var consecutiveFailures = 0;
var roomSettings = /* @__PURE__ */ new Map();
var pendingSteerMessages = /* @__PURE__ */ new Map();
var knownWorkdirs = /* @__PURE__ */ new Set();
var reauthProc = null;
var consecutiveTriggerErrors = 0;
var MAX_TRIGGER_ERRORS = 3;
var TRIGGER_TIMEOUT = 5 * 6e4;
var FIRST_TOKEN_TIMEOUT = 10 * 6e4;
var MAX_CONCURRENT = parseInt(process.env.STOA_MAX_CONCURRENT || "1");
var UPDATE_INTERVAL = 12e4;
var UPDATE_FILES = ["stoa.js", "claude-session.js", "codex-session.js"];
var TREE_IGNORE = /* @__PURE__ */ new Set([".git", "node_modules", ".next", "__pycache__", ".venv", "dist", "build", ".claude"]);
function isPathSafe(filePath, workdir) {
  const resolved = path.resolve(filePath);
  const wdResolved = path.resolve(workdir);
  const norm = (p) => process.platform === "win32" ? p.toLowerCase() : p;
  if (!norm(resolved).startsWith(norm(wdResolved + path.sep)) && norm(resolved) !== norm(wdResolved)) return false;
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) return false;
      const real = fs.realpathSync(filePath);
      if (!norm(real).startsWith(norm(wdResolved + path.sep)) && norm(real) !== norm(wdResolved)) return false;
    }
  } catch {
  }
  return true;
}
function buildFileTreeAgent(dirPath, rootPath, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  const dirs = entries.filter((e) => e.isDirectory() && !TREE_IGNORE.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const children = buildFileTreeAgent(path.join(dirPath, d.name), rootPath, depth + 1, maxDepth);
    result.push({ t: "folder", name: d.name, depth, open: depth < 1, children });
  }
  for (const f of files) {
    const ext = path.extname(f.name).slice(1);
    result.push({ t: ext || "file", name: f.name, depth });
  }
  return result;
}
function contentHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
}
function buildLocalManifest() {
  const manifest = {};
  for (const name of UPDATE_FILES) {
    const fp = path.join(__dirname, name);
    if (fs.existsSync(fp)) manifest[name] = contentHash(fs.readFileSync(fp));
  }
  return manifest;
}
var localManifest = buildLocalManifest();
var updateChecker = null;
// opts exist for tests only; production always updates the agent's own directory.
async function checkForUpdates(opts = {}) {
  const baseUrl = opts.baseUrl || STOA_URL.replace(/^ws/, "http");
  const dir = opts.dir || __dirname;
  const manifest = opts.manifest || localManifest;
  try {
    const body = await fetchText(`${baseUrl}/api/client/manifest`);
    const remote = JSON.parse(body).files || {};
    const changed = filesToUpdate(remote, manifest, UPDATE_FILES);
    if (!changed.length) return;
    console.log(`[stoa:update] update detected: ${changed.join(", ")}`);
    const updated = [];
    for (const name of changed) {
      const content = await fetchText(`${baseUrl}/api/client/file/${encodeURIComponent(name)}`);
      // A file that does not match its manifest hash would be "updated" again after every
      // restart; with the pre-connect check that is a tight restart loop, so never write it.
      const got = contentHash(Buffer.from(content, "utf8"));
      if (got !== remote[name]) {
        console.warn(`[stoa:update] ${name} skipped \u2014 hash ${got} != manifest ${remote[name]}`);
        continue;
      }
      fs.writeFileSync(path.join(dir, name), content, "utf8");
      manifest[name] = remote[name];
      updated.push(name);
      console.log(`[stoa:update] ${name} updated`);
    }
    if (!updated.length) return;
    if (activeTriggers.size > 0 || triggerQueue.length > 0) {
      armPendingRestart("update downloaded");
      console.log("[stoa:update] restart deferred \u2014 trigger in progress");
      return;
    }
    doRestart();
  } catch (err) {
    console.error(`[stoa:update] check failed: ${err.message}`);
  }
}
// Runs before the first connect: an old client only knows its own UPDATE_FILES, so the
// process it restarts into may need one more update+restart. Doing that check here keeps
// the extra restart before the agent shows up online. Capped so a slow server can't hold
// the agent offline; a late result still applies through the normal path.
var PRE_CONNECT_UPDATE_MS = 10e3;
function preConnectUpdate(opts = {}, capMs = PRE_CONNECT_UPDATE_MS) {
  let timer;
  const cap = new Promise((resolve) => { timer = setTimeout(resolve, capMs); });
  return Promise.race([checkForUpdates(opts), cap]).finally(() => clearTimeout(timer));
}
// A pending restart waits for triggers to finish, but the server refuses new triggers to an
// outdated agent, so a trigger that hangs holds the old version forever (newfin: 10 days).
// Progress = entry.lastActivity (tokens, state, tools, status, retries). Measured from when
// the restart was armed at the earliest, so a long-silent trigger still gets the full window.
// A tool call (test suite, build) is silent until it returns, so while one is in flight the
// window stretches to TOOL_STALL_MS (see idleLimit) — a hard cap, the newfin hang stays bounded.
var RESTART_STALL_MS = 3 * 60e3;
// One idle bound for every trigger watchdog (hang, stale sweep, pending restart): a silent
// tool in flight may run up to TOOL_STALL_MS before any of them treats the trigger as hung.
var TOOL_STALL_MS = 30 * 60e3;
var MCP_TOOL_TIMEOUT_MS = 12 * 60e3;
function idleLimit(entry, baseMs) {
  return entry?.toolInFlight ? Math.max(baseMs, TOOL_STALL_MS) : baseMs;
}
var pendingRestartSince = 0;
function armPendingRestart(reason) {
  if (pendingRestart) return;
  pendingRestart = true;
  pendingRestartSince = Date.now();
  console.log(`[stoa:update] restart pending (${reason}) \u2014 forced after ${RESTART_STALL_MS / 1e3}s without trigger progress`);
}
function forceRestartIfStalled(now) {
  if (!pendingRestart) return false;
  let lastProgress = pendingRestartSince;
  let toolInFlight = false;
  for (const entry of activeTriggers.values()) {
    lastProgress = Math.max(lastProgress, entry.lastActivity || entry.startedAt || 0);
    if (entry.toolInFlight) toolInFlight = true;
  }
  if (now - lastProgress < idleLimit({ toolInFlight }, RESTART_STALL_MS)) return false;
  console.warn(`[stoa:update] no trigger progress for ${Math.round((now - lastProgress) / 1e3)}s \u2014 forcing restart (${activeTriggers.size} active, ${triggerQueue.length} queued)`);
  sendThenRestart({ type: "restart_status", state: "restarting", reason: "update_stalled", active: activeTriggers.size, queued: triggerQueue.length });
  return true;
}
var _restartOverride = null;
function doRestart() {
  if (_restartOverride) return _restartOverride();
  console.log("[stoa:update] restarting to apply...");
  clearInterval(keepAlive);
  clearInterval(updateChecker);
  clearTimeout(reconnectTimer);
  for (const s of sessionPool.values()) s.shutdown();
  ws?.close();
  process.exit(0);
}
// process.exit right after ws.send can drop the frame; exit from the send callback, with a cap.
function sendThenRestart(data) {
  let done = false;
  const go = () => { if (done) return; done = true; doRestart(); };
  if (_sendOverride || ws?.readyState !== WebSocket.OPEN) { send(data); return go(); }
  ws.send(JSON.stringify(data), go);
  setTimeout(go, 1e3).unref();
}
var sessionPool = /* @__PURE__ */ new Map();
// Must match MAX_UPLOAD in server.js /api/upload/raw.
var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
function formatMB(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
var sessionIdleTimers = /* @__PURE__ */ new Map();
var SESSION_IDLE_TTL = 5;
var AUTO_COMPACT_THRESHOLD = parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB || "300") * 1024;
var compactsInFlight = /* @__PURE__ */ new Set();
var COMPACT_IDLE_MS = parseInt(process.env.COMPACT_IDLE_TIMEOUT_MS || String(2 * 60 * 1e3));
var COMPACT_HARD_MS = parseInt(process.env.COMPACT_HARD_TIMEOUT_MS || String(10 * 60 * 1e3));
function compactWithTimeout(session) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let idleTimer;
    const hardTimer = setTimeout(() => {
      timedOut = true;
      clearTimeout(idleTimer);
      warnBackgroundKill(session, "compact hard timeout");
      session.abort();
      reject(new Error(`compact hard ceiling exceeded (${COMPACT_HARD_MS / 6e4} min)`));
    }, COMPACT_HARD_MS);
    const resetIdle = () => {
      if (timedOut) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        clearTimeout(hardTimer);
        warnBackgroundKill(session, "compact idle timeout");
        session.abort();
        reject(new Error(`compact idle timeout (${COMPACT_IDLE_MS / 6e4} min without output)`));
      }, COMPACT_IDLE_MS);
    };
    resetIdle();
    session.send({ prompt: "/compact", onState: resetIdle, onToken: resetIdle }).then((result) => {
      if (timedOut) return;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      resolve(result);
    }).catch((err) => {
      if (timedOut) return;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      reject(err);
    });
  });
}
function sessionFilePath(workdir, sessionId) {
  if (!workdir || !sessionId) return null;
  const encoded = workdir.replace(/\//g, "-").replace(/\\/g, "-").replace(/:/g, "");
  return path.join(os.homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}
async function getSessionFileSize(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return 0;
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}
function deleteSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    fs.unlinkSync(filePath);
    console.log(`[stoa] cleanup: deleted session file ${sessionId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`[stoa] cleanup: delete error: ${err.message}`);
  }
}
function truncateSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim());
    let lastBoundary = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        if (JSON.parse(lines[i]).subtype === "compact_boundary") {
          lastBoundary = i;
          break;
        }
      } catch {
      }
    }
    if (lastBoundary <= 0) return;
    fs.writeFileSync(filePath, lines.slice(lastBoundary).join("\n") + "\n", "utf8");
    console.log(`[stoa] compact: truncated ${lastBoundary} old entries from session file`);
  } catch (err) {
    console.error(`[stoa] compact: truncate error: ${err.message}`);
  }
}
function stripBlocksFromEntry(obj, matchFn, makeReplacement) {
  if (!obj || typeof obj !== "object") return false;
  let stripped = false;
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i--) {
      if (obj[i] && typeof obj[i] === "object" && matchFn(obj[i])) {
        const replacement = makeReplacement(obj[i]);
        if (replacement === null) {
          obj.splice(i, 1);
        } else {
          obj[i] = replacement;
        }
        stripped = true;
      } else if (stripBlocksFromEntry(obj[i], matchFn, makeReplacement)) {
        stripped = true;
      }
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (stripBlocksFromEntry(obj[key], matchFn, makeReplacement)) stripped = true;
    }
  }
  return stripped;
}
async function sanitizeSession(workdir, sessionId, needles, matchFn, makeReplacement, label) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    let raw;
    try {
      raw = await fs.promises.readFile(filePath, "utf8");
    } catch {
      return;
    }
    if (!needles.some((n) => raw.includes(n))) return;
    const lines = raw.split("\n");
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || !needles.some((n) => line.includes(n))) continue;
      try {
        const entry = JSON.parse(line);
        if (stripBlocksFromEntry(entry, matchFn, makeReplacement)) {
          lines[i] = JSON.stringify(entry);
          changed = true;
        }
      } catch {
      }
    }
    if (changed) {
      await fs.promises.writeFile(filePath, lines.join("\n"), "utf8");
      console.log(`[stoa] ${label} in session ${sessionId.slice(0, 8)}...`);
    }
  } catch (err) {
    console.error(`[stoa] sanitize (${label}) error: ${err.message}`);
  }
}
function stripSessionImages(workdir, sessionId) {
  return sanitizeSession(
    workdir,
    sessionId,
    ['"type":"image"', '"type": "image"'],
    (b) => b.type === "image" && b.source,
    () => ({ type: "text", text: "[image]" }),
    "stripped image data"
  );
}
function sanitizeThinking(workdir, sessionId, opts = {}) {
  const { thirdParty = false, aggressive = false } = opts;
  const stripAll = thirdParty || aggressive;
  const blockOpts = { stripAll };
  return sanitizeSession(
    workdir,
    sessionId,
    ['"type":"thinking"', '"type": "thinking"', '"type":"redacted_thinking"', '"type": "redacted_thinking"', "[thinking]"],
    (b) => matchThinkingBlock(b, blockOpts),
    (b) => replaceThinkingBlock(b, blockOpts),
    stripAll ? "stripped all thinking (third-party/recovery)" : "sanitized thinking residue"
  );
}
var transcriptNoticeEmitted = /* @__PURE__ */ new Set();
async function sanitizeTranscript(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return null;
  try {
    let raw;
    try {
      raw = await fs.promises.readFile(filePath, "utf8");
    } catch {
      return null;
    }
    if (!/"tool_use"|"tool_result"|"content":\[]/.test(raw)) return null;
    const lines = raw.split("\n");
    const entries = [];
    const lineMap = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        entries.push(JSON.parse(lines[i]));
        lineMap.push(i);
      } catch {
        entries.push(null);
        lineMap.push(i);
      }
    }
    const anomalies = findAnomalies(entries);
    if (!hasAnomalies(anomalies)) return null;
    const fixed = fixAnomalies(entries, anomalies);
    if (fixed === 0) return null;
    for (let j = 0; j < entries.length; j++) {
      if (entries[j] && lineMap[j] !== void 0) {
        lines[lineMap[j]] = JSON.stringify(entries[j]);
      }
    }
    if (entries.length > lineMap.length) {
      for (let j = lineMap.length; j < entries.length; j++) {
        lines.push(JSON.stringify(entries[j]));
      }
    }
    await fs.promises.writeFile(filePath, lines.join("\n"), "utf8");
    const level = escalationLevel(anomalies);
    const notice = formatNotice(anomalies, fixed);
    console.log(`[stoa] ${notice}`);
    return { level, notice, anomalies, fixed };
  } catch (err) {
    console.error(`[stoa] transcript sanitizer error: ${err.message}`);
    return null;
  }
}
async function backupSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return null;
  const backupPath = filePath + ".sig-bak";
  try {
    await fs.promises.copyFile(filePath, backupPath);
    console.log(`[stoa] backed up session ${sessionId.slice(0, 8)}... \u2192 .sig-bak`);
    return backupPath;
  } catch (err) {
    console.error(`[stoa] backup error: ${err.message}`);
    return null;
  }
}
const { createHarnessSession: _createHS, supportsCompact, buildResumeArgs, parseClaudeAuthStatus, parseCodexLoginStatus, parseCodexModels, filesToUpdate, detectClaudeModelCandidates } = require("./harness-session");
function createHarnessSession(harness, opts) {
  return _createHS(harness, opts, { ClaudeSession });
}
async function prepareResume({ targetDir, rid, targetModel, toolsSupported, env, sessionKey, thirdParty = false, aggressive = false, systemPrompt = null, systemPromptHash = null, harness = "claude" }) {
  if (harness === "claude" && rid && !compactsInFlight.has(sessionKey)) {
    await sanitizeThinking(targetDir, rid, { thirdParty, aggressive });
    const tsResult = await sanitizeTranscript(targetDir, rid);
    if (tsResult && (tsResult.level === "warning" || tsResult.level === "error") && !transcriptNoticeEmitted.has(sessionKey)) {
      transcriptNoticeEmitted.add(sessionKey);
      try {
        send({ type: "agent_system_event", status: `[${tsResult.level.toUpperCase()}] ${tsResult.notice}` });
      } catch {
      }
    }
  }
  const flags = rid ? ["--resume", rid] : [];
  if (targetModel) flags.push("--model", targetModel);
  if (harness === "claude") {
    if (toolsSupported === false) flags.push("--tools", "");
    if (systemPrompt) flags.push("--append-system-prompt", systemPrompt);
  }
  const session = createHarnessSession(harness, { workDir: targetDir, flags, resumeId: rid || null, env, systemPrompt: harness === "codex" ? systemPrompt : null, model: targetModel });
  session._systemPromptHash = systemPromptHash || null;
  session._harness = harness;
  attachUnsolicitedHandler(session, sessionKey);
  sessionPool.set(sessionKey, session);
  return session;
}
function buildSessionKey(workdir, roomId, threadId, subAgentId) {
  const base = `${path.resolve(workdir)}::${roomId || "default"}::t:${threadId || 0}`;
  return subAgentId ? `${base}::sub:${subAgentId}` : base;
}
function parseSessionKey(key) {
  const parts = key.split("::");
  const roomId = parts[1] !== "default" ? parseInt(parts[1]) : null;
  const threadMatch = parts[2]?.match(/^t:(\d+)$/);
  const threadId = threadMatch ? parseInt(threadMatch[1]) : 0;
  const subMatch = parts[3]?.match(/^sub:(\d+)$/);
  const subAgentId = subMatch ? parseInt(subMatch[1]) : null;
  return { roomId, threadId: threadId || null, subAgentId };
}
function getSession(workdir, roomId, env, subAgentId, threadId, systemPrompt, systemPromptHash, harness = "claude") {
  const key = buildSessionKey(workdir, roomId, threadId, subAgentId);
  clearSessionIdleTimer(key);
  let session = sessionPool.get(key);
  if (!session) {
    const flags = [];
    if (harness === "claude" && systemPrompt) flags.push("--append-system-prompt", systemPrompt);
    session = createHarnessSession(harness, { workDir: path.resolve(workdir), env: env || null, flags: flags.length ? flags : void 0, systemPrompt: harness === "codex" ? systemPrompt : null });
    session._systemPromptHash = systemPromptHash || null;
    session._harness = harness;
    attachUnsolicitedHandler(session, key);
    sessionPool.set(key, session);
    console.log(`[stoa] ${harness} session started for ${key}`);
    startSessionIdleTimer(key);
  }
  return session;
}
// SIGTERM to the claude process also kills its background shells, so an idle session that still
// runs one is kept alive (bounded, so a forgotten `sleep infinity` cannot pin a process forever).
var BACKGROUND_HOLD_MAX_MS = 3 * 60 * 60 * 1e3;
function describeBackgroundTasks(session) {
  const tasks = session?._backgroundTasks || [];
  return tasks.map((t) => t?.description || t?.task_id || "?").join("; ").slice(0, 200);
}
function warnBackgroundKill(session, reason, sessionKey = "") {
  if (!session?.hasBackgroundTasks?.()) return;
  console.warn(`[stoa] ${reason}: terminating session with ${session._backgroundTasks.length} background task(s) still running [${describeBackgroundTasks(session)}] ${sessionKey}`);
}
function startSessionIdleTimer(sessionKey, holdSince = null) {
  clearSessionIdleTimer(sessionKey);
  const timer = setTimeout(() => {
    const session = sessionPool.get(sessionKey);
    if (!session || session.busy) return;
    const holding = session.hasBackgroundTasks?.() || session.isTurnActive?.();
    if (holding) {
      const since = holdSince || Date.now();
      const heldMs = Date.now() - since;
      if (heldMs < BACKGROUND_HOLD_MAX_MS) {
        console.log(`[stoa] session kept alive (idle ${SESSION_IDLE_TTL}m, held ${Math.round(heldMs / 6e4)}m): ${session.isTurnActive?.() ? "autonomous turn running" : `background task(s) [${describeBackgroundTasks(session)}]`} ${sessionKey}`);
        startSessionIdleTimer(sessionKey, since);
        return;
      }
      warnBackgroundKill(session, `idle hold limit ${BACKGROUND_HOLD_MAX_MS / 36e5}h reached`, sessionKey);
    }
    session.shutdown();
    sessionPool.delete(sessionKey);
    sessionIdleTimers.delete(sessionKey);
    console.log(`[stoa] session closed (idle ${SESSION_IDLE_TTL}m): ${sessionKey}`);
  }, SESSION_IDLE_TTL * 6e4);
  // unref: housekeeping only — the agent stays alive via its WS/keepAlive; a ref'd timer
  // here kept in-process importers (test.js) from exiting.
  timer.unref?.();
  sessionIdleTimers.set(sessionKey, timer);
}
function clearSessionIdleTimer(sessionKey) {
  const timer = sessionIdleTimers.get(sessionKey);
  if (timer) {
    clearTimeout(timer);
    sessionIdleTimers.delete(sessionKey);
  }
}
setInterval(async () => {
  if (ACTOR_TYPE !== "ai") return;
  const busySessionKeys = new Set([...activeTriggers.values()].filter((t) => t.sessionKey).map((t) => t.sessionKey));
  for (const [sessionKey, session] of sessionPool) {
    if (busySessionKeys.has(sessionKey)) continue;
    if (!supportsCompact(session._harness)) continue;
    const workdir = sessionKey.split("::")[0];
    const sessionId = session.resumeId;
    if (!sessionId) continue;
    const fileSize = await getSessionFileSize(workdir, sessionId);
    if (fileSize <= AUTO_COMPACT_THRESHOLD) continue;
    if (compactsInFlight.has(sessionKey)) continue;
    compactsInFlight.add(sessionKey);
    const skMeta = parseSessionKey(sessionKey);
    console.log(`[stoa] worker: auto-compacting ${sessionId.slice(0, 8)}... (${(fileSize / 1024).toFixed(0)}KB) thread=${skMeta.threadId || 0}`);
    send({ type: "auto_compact_start", claude_session_id: sessionId, thread_id: skMeta.threadId, sub_agent_id: skMeta.subAgentId });
    compactWithTimeout(session).then((result) => {
      compactsInFlight.delete(sessionKey);
      if (result?.sessionId) session.resumeId = result.sessionId;
      send({ type: "compact_complete", claude_session_id: result?.sessionId || sessionId, orig_session_id: sessionId, thread_id: skMeta.threadId, sub_agent_id: skMeta.subAgentId, result: result?.content || "" });
      setTimeout(() => {
        truncateSessionFile(workdir, sessionId);
        if (result?.sessionId && result.sessionId !== sessionId) truncateSessionFile(workdir, result.sessionId);
      }, 3e3);
    }).catch((err) => {
      compactsInFlight.delete(sessionKey);
      console.error(`[stoa] worker auto-compact error: ${err.message}`);
      send({ type: "compact_error", orig_session_id: sessionId, thread_id: skMeta.threadId, sub_agent_id: skMeta.subAgentId, error: err.message });
    });
  }
}, 60 * 6e4).unref();
function execWithTimeout(cmd, args, timeout) {
  const { execFile } = require("child_process");
  return new Promise((resolve) => {
    try {
      const child = execFile(cmd, args, { encoding: "utf8", timeout, windowsHide: true }, (err, stdout) => {
        resolve({ exitCode: err ? (err.code === "ENOENT" ? -1 : (err.killed ? -2 : (typeof err.code === 'number' ? err.code : 1))) : 0, stdout: stdout || "" });
      });
      child.on("error", () => resolve({ exitCode: -1, stdout: "" }));
    } catch {
      resolve({ exitCode: -1, stdout: "" });
    }
  });
}
async function detectHarnessesAsync() {
  const [claudeVer, codexVer] = await Promise.all([
    execWithTimeout("claude", ["--version"], 5e3),
    execWithTimeout("codex", ["--version"], 5e3),
  ]);
  const status = [];
  let claude_model_candidates = null;
  let claude_cli_version = null;
  if (claudeVer.exitCode >= 0) {
    const version = claudeVer.stdout.trim().split("\n")[0] || null;
    const authResult = await execWithTimeout("claude", ["auth", "status"], 5e3);
    const loggedIn = parseClaudeAuthStatus(authResult.stdout);
    status.push({ id: "claude", installed: claudeVer.exitCode === 0, logged_in: loggedIn, version, models: null });
    if (claudeVer.exitCode === 0) {
      try {
        claude_model_candidates = await detectClaudeModelCandidates();
        claude_cli_version = version;
      } catch (err) {
        console.error(`[stoa] Claude model scan failed: ${err.message}`);
      }
    }
  }
  if (codexVer.exitCode >= 0) {
    const version = codexVer.stdout.trim().split("\n")[0] || null;
    const loginResult = await execWithTimeout("codex", ["login", "status"], 5e3);
    const loggedIn = codexVer.exitCode === 0 ? parseCodexLoginStatus(loginResult.exitCode) : null;
    let models = null;
    if (codexVer.exitCode === 0) {
      const modelsResult = await execWithTimeout("codex", ["debug", "models"], 5e3);
      if (modelsResult.exitCode === 0) models = parseCodexModels(modelsResult.stdout);
    }
    status.push({ id: "codex", installed: codexVer.exitCode === 0, logged_in: loggedIn, version, models });
  }
  const harnesses_available = status.filter((s) => s.installed).map((s) => s.id);
  return { harnesses_available, harness_status: status, claude_model_candidates, claude_cli_version };
}
// A server/proxy that vanished without a FIN leaves this socket half-open and no 'close' ever
// fires, so the agent would never reconnect. The server pings every STOA_WS_HEARTBEAT_MS (30 s);
// silence past max(90 s, 3 observed ping gaps) terminates the socket -> normal reconnect path.
// Any inbound byte counts: a ping queued behind a large frame on a slow link is not silence.
// Armed only by the first ping: servers without a heartbeat (e.g. v0.68.1) never ping and must not
// be dropped.
var HEARTBEAT_MIN_SILENCE_MS = 9e4;
var HEARTBEAT_MISSED_PINGS = 3;
var HEARTBEAT_CHECK_MS = 5e3;
function attachHeartbeatWatchdog(sock) {
  let lastPingAt = 0, pingGap = 0, lastSeenAt = 0;
  const silenceLimit = () => Math.max(HEARTBEAT_MIN_SILENCE_MS, pingGap * HEARTBEAT_MISSED_PINGS);
  sock.on("ping", () => {
    const now = Date.now();
    if (lastPingAt) pingGap = now - lastPingAt;
    lastPingAt = lastSeenAt = now;
  });
  const markSeen = () => {
    if (lastPingAt) lastSeenAt = Date.now();
  };
  sock.on("message", markSeen);
  sock.on("upgrade", (res) => res.socket.on("data", markSeen));
  const timer = setInterval(() => {
    if (!lastPingAt) return;
    const silent = Date.now() - lastSeenAt;
    if (silent <= silenceLimit()) return;
    clearInterval(timer);
    console.log(`[stoa] No ping from server for ${Math.round(silent / 1e3)}s \u2014 connection presumed dead, reconnecting`);
    sock.terminate();
  }, HEARTBEAT_CHECK_MS);
  sock.on("close", () => clearInterval(timer));
}
function connect() {
  const cfHeaders = stoaCfHeaders(STOA_URL);
  ws = Object.keys(cfHeaders).length ? new WebSocket(STOA_URL, { headers: cfHeaders }) : new WebSocket(STOA_URL);
  attachHeartbeatWatchdog(ws);
  ws.on("open", () => {
    if (ACTOR_TYPE === "ai") {
      getSession(process.env.STOA_WORK_DIR || os.homedir(), "default");
      // active_message_ids: runs survive a reconnect, so the server must not orphan them.
      ws.send(JSON.stringify({ type: "agent_connect", actor_id: ACTOR_ID, secret: STOA_SECRET, client_version: CLIENT_VERSION, features: ["skills", "skill_sync"], harnesses_available: [], supervisor: SUPERVISOR, boot_id: BOOT_ID, active_message_ids: activeMessageIds() }));
      sendQueueStatus();
      console.log(`[stoa] Agent #${ACTOR_ID} v${CLIENT_VERSION} connected to ${STOA_URL} (max_concurrent=${MAX_CONCURRENT})`);
      detectHarnessesAsync().then((result) => {
        send({ type: "harnesses_update", ...result });
        console.log(`[stoa] Harnesses: ${result.harness_status.map((s) => `${s.id}${s.installed ? " v" + s.version : " (not found)"}${s.logged_in === false ? " (not logged in)" : ""}`).join(", ") || "none"}`);
      }).catch(() => {});
    } else {
      ws.send(JSON.stringify({ type: "join_room", room_id: ROOM_ID }));
      printHeader();
      startPrompt();
    }
  });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (ACTOR_TYPE === "ai") {
      handleAgentMessage(msg);
    } else {
      handleHumanMessage(msg);
    }
  });
  ws.on("close", () => {
    setOutboxReady(false);
    if (ACTOR_TYPE === "ai") {
      consecutiveFailures++;
      const delay = Math.min(5e3 * Math.pow(2, consecutiveFailures - 1), 6e4);
      console.log(`[stoa] Disconnected (attempt ${consecutiveFailures}), reconnecting in ${delay / 1e3}s...`);
      reconnectTimer = setTimeout(connect, delay);
    } else {
      process.stdout.write("\n" + C.gray + "Disconnected." + C.reset + "\n");
      process.exit(0);
    }
  });
  ws.on("error", (err) => {
    if (ACTOR_TYPE !== "ai") {
      process.stdout.write(C.red + "Connection error: " + err.message + C.reset + "\n");
    }
  });
}
function expandHome(p) {
  if (typeof p !== "string" || !p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}
async function handleAgentMessage(msg) {
  if (msg && typeof msg.workdir === "string") msg.workdir = expandHome(msg.workdir);
  if (msg.type === "auth_error") {
    console.error(`[stoa] Auth failed: ${msg.message}. Set STOA_SECRET correctly and restart.`);
    process.exit(1);
  }
  if (msg.type === "agent_ready") {
    consecutiveFailures = 0;
    setOutboxReady(true);
    console.log("[stoa] Ready, waiting for triggers...");
    (async () => {
      try {
        const scanResult = scanForWorkdirs();
        console.log(`[stoa] Scanned: ${scanResult.workdirs.length} workdirs`);
        send({ type: "agent_scan_result", ...scanResult });
      } catch (err) {
        console.error("[stoa] Scan failed:", err.message);
      }
    })();
  }
  if (msg.type === "set_config") {
    if (msg.max_concurrent !== void 0) {
      const prev = MAX_CONCURRENT;
      MAX_CONCURRENT = Math.max(1, Math.min(10, parseInt(msg.max_concurrent) || 1));
      if (prev !== MAX_CONCURRENT) console.log(`[stoa] max_concurrent: ${prev} \u2192 ${MAX_CONCURRENT}`);
      drainQueue();
    }
    if (msg.session_idle_ttl !== void 0) {
      const prev = SESSION_IDLE_TTL;
      SESSION_IDLE_TTL = Math.max(1, Math.min(60, parseInt(msg.session_idle_ttl) || 5));
      if (prev !== SESSION_IDLE_TTL) console.log(`[stoa] session_idle_ttl: ${prev} \u2192 ${SESSION_IDLE_TTL}m`);
    }
    if (msg.auto_compact_threshold_kb !== void 0) {
      const prev = AUTO_COMPACT_THRESHOLD;
      AUTO_COMPACT_THRESHOLD = Math.max(100, Math.min(5e3, parseInt(msg.auto_compact_threshold_kb) || 500)) * 1024;
      if (prev !== AUTO_COMPACT_THRESHOLD) console.log(`[stoa] auto_compact_threshold: ${prev / 1024}KB \u2192 ${AUTO_COMPACT_THRESHOLD / 1024}KB`);
    }
  }
  if (msg.type === "room_setting") {
    if (!roomSettings.has(msg.room_id)) roomSettings.set(msg.room_id, {});
    const rs = roomSettings.get(msg.room_id);
    if (msg.value === null || msg.value === void 0) {
      delete rs[msg.key];
    } else {
      rs[msg.key] = msg.value;
    }
  }
  if (msg.type === "steer_message") {
    const key = `${msg.room_id}:${msg.thread_id || 0}`;
    if (!pendingSteerMessages.has(key)) pendingSteerMessages.set(key, []);
    pendingSteerMessages.get(key).push({ content: msg.content, message_id: msg.message_id });
    console.log(`[stoa] steer queued for room ${msg.room_id} thread=${msg.thread_id || 0} msg=${msg.message_id}`);
  }
  if (msg.type === "force_update") {
    console.log("[stoa] Force update requested");
    checkForUpdates();
  }
  if (msg.type === "request_scan") {
    try {
      const scanResult = scanForWorkdirs();
      console.log(`[stoa] Rescan: ${scanResult.workdirs.length} workdirs`);
      send({ type: "agent_scan_result", ...scanResult });
    } catch (err) {
      console.error("[stoa] Rescan failed:", err.message);
    }
    detectHarnessesAsync().then((result) => {
      send({ type: "harnesses_update", ...result, request_id: msg.request_id });
    }).catch(() => {});
  }
  if (msg.type === "check_harnesses") {
    detectHarnessesAsync().then((result) => {
      send({ type: "harnesses_update", ...result, request_id: msg.request_id });
      console.log(`[stoa] Harness check: ${result.harness_status.map((s) => `${s.id}${s.installed ? " v" + s.version : " (not found)"}${s.logged_in === false ? " (not logged in)" : ""}`).join(", ") || "none"}`);
    }).catch(() => {});
  }
  if (msg.type === "restart" && msg.reason === "manual") {
    // Owner asked for it and was warned: stop now, don't wait for idle. doRestart shuts the
    // sessions down; the server marks this agent's in-flight messages as interrupted on disconnect.
    console.log(`[stoa] Restart requested from UI \u2014 stopping ${activeTriggers.size} active, ${triggerQueue.length} queued trigger(s)`);
    sendThenRestart({ type: "restart_status", state: "restarting", active: activeTriggers.size, queued: triggerQueue.length });
    return;
  }
  if (msg.type === "restart") {
    console.log("[stoa] Server requested restart (version outdated)");
    armPendingRestart("server: version outdated");
    if (activeTriggers.size === 0 && triggerQueue.length === 0) doRestart();
    return;
  }
  if (msg.type === "server_restarting") {
    console.log("[stoa] Server restarting \u2014 will reconnect automatically");
    clearTimeout(reconnectTimer);
    ws?.close();
    return;
  }
  if (msg.type === "server_restart") {
    console.log(`[stoa] Server restarting on new port \u2192 ${msg.new_ws_url}`);
    STOA_URL = msg.new_ws_url;
    clearTimeout(reconnectTimer);
    ws?.close();
    return;
  }
  if (msg.type === "cancel_generation") {
    console.log(`[stoa] Cancel requested for message ${msg.message_id}`);
    const qIdx = triggerQueue.findIndex((t) => t.message_id === msg.message_id);
    if (qIdx !== -1) {
      triggerQueue.splice(qIdx, 1);
      send({ type: "agent_complete", room_id: msg.room_id, message_id: msg.message_id, content: "(cancelled before processing)" });
      console.log(`[stoa] Cancelled queued msg=${msg.message_id}`);
      sendQueueStatus();
    } else {
      const active = activeTriggers.get(msg.message_id);
      if (active?.session) {
        warnBackgroundKill(active.session, `cancel by user msg=${msg.message_id}`, active.sessionKey || "");
        if (active.session.cancelTask) {
          active.session.cancelTask(msg.message_id);
        } else {
          active.session.abort();
        }
      }
    }
  }
  if (msg.type === "create_workdir") {
    try {
      const resolved = path.resolve(expandHome(msg.path));
      fs.mkdirSync(resolved, { recursive: true });
      const claudeMd = path.join(resolved, "CLAUDE.md");
      if (!fs.existsSync(claudeMd)) fs.writeFileSync(claudeMd, "", "utf8");
      knownWorkdirs.add(resolved);
      console.log(`[stoa] Created workdir: ${resolved}`);
      send({ type: "workdir_created", requested: msg.path, path: resolved });
    } catch (err) {
      console.error("[stoa] Failed to create workdir:", err.message);
      send({ type: "workdir_created", requested: msg.path, error: err.message });
    }
  }
  if (msg.type === "skill_sync") {
    // stoa__skill_use: put the skill in the local cache and tell the server where it is.
    const rid = msg.request_id;
    ensureSkill(msg.skill).then((r) => {
      send(r.error ? { type: "skill_sync_result", request_id: rid, error: r.error } : { type: "skill_sync_result", request_id: rid, dir: r.dir, version: r.version, stale: r.stale });
    }).catch((e) => send({ type: "skill_sync_result", request_id: rid, error: e.message }));
    return;
  }
  if (msg.type === "avatar_file_read") {
    const r = readAvatarFile(expandHome(msg.path));
    send({ type: "avatar_file_read_result", request_id: msg.request_id, ...r });
    return;
  }
  if (msg.type === "proxy_file_list") {
    try {
      const tree = buildFileTreeAgent(msg.workdir, msg.workdir, 0, 3);
      let modified = [];
      try {
        const status = spawnSync("git", ["status", "--porcelain"], { cwd: msg.workdir, encoding: "utf8", maxBuffer: 512 * 1024, windowsHide: true, timeout: 1e4 });
        if (status.stdout) modified = status.stdout.split("\n").filter(Boolean).map((l) => l.slice(3).trim());
      } catch {
      }
      send({ type: "proxy_file_list_result", request_id: msg.request_id, root: msg.workdir, tree, modified });
    } catch (e) {
      send({ type: "proxy_file_list_result", request_id: msg.request_id, error: e.message });
    }
  }
  if (msg.type === "proxy_file_read") {
    try {
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: "proxy_file_read_result", request_id: msg.request_id, error: "path traversal blocked" });
        return;
      }
      if (msg.binary) {
        const data = fs.readFileSync(filePath);
        send({ type: "proxy_file_read_result", request_id: msg.request_id, path: msg.path, base64: data.toString("base64") });
      } else {
        const content = fs.readFileSync(filePath, "utf8");
        send({ type: "proxy_file_read_result", request_id: msg.request_id, path: msg.path, content });
      }
    } catch (e) {
      send({ type: "proxy_file_read_result", request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }
  if (msg.type === "proxy_git_diff") {
    try {
      const status = spawnSync("git", ["diff"], { cwd: msg.workdir, encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true, timeout: 1e4 });
      const raw = status.stdout || "";
      const files = [];
      let current = null;
      for (const line of raw.split("\n")) {
        if (line.startsWith("diff --git")) {
          const match = line.match(/b\/(.+)$/);
          current = { name: match ? match[1] : "?", hunks: [], add: 0, del: 0 };
          files.push(current);
        } else if (line.startsWith("@@") && current) {
          current.hunks.push({ k: "hunk", text: line });
        } else if (current && current.hunks.length) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            current.hunks.push({ k: "add", text: line.slice(1) });
            current.add++;
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            current.hunks.push({ k: "del", text: line.slice(1) });
            current.del++;
          } else if (line.startsWith(" ")) {
            current.hunks.push({ k: "ctx", text: line.slice(1) });
          }
        }
      }
      send({ type: "proxy_git_diff_result", request_id: msg.request_id, files });
    } catch (e) {
      send({ type: "proxy_git_diff_result", request_id: msg.request_id, error: e.message });
    }
  }
  if (msg.type === "proxy_file_write") {
    try {
      const BINARY_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "exe", "dll", "so", "bin", "zip", "tar", "gz", "7z", "mp3", "mp4", "avi", "mov"]);
      const ext = (msg.path.match(/\.(\w+)$/) || [])[1] || "";
      if (BINARY_EXTS.has(ext)) {
        send({ type: "proxy_file_write_result", request_id: msg.request_id, error: "binary files cannot be edited" });
        return;
      }
      if (typeof msg.content !== "string" || msg.content.length > 1024 * 1024) {
        send({ type: "proxy_file_write_result", request_id: msg.request_id, error: "content too large (max 1MB)" });
        return;
      }
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: "proxy_file_write_result", request_id: msg.request_id, error: "path traversal blocked" });
        return;
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, msg.content, "utf8");
      send({ type: "proxy_file_write_result", request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: "proxy_file_write_result", request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }
  if (msg.type === "proxy_file_create") {
    try {
      if (/[<>"|?*]/.test(msg.path)) {
        send({ type: "proxy_file_create_result", request_id: msg.request_id, error: "invalid characters in path" });
        return;
      }
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: "proxy_file_create_result", request_id: msg.request_id, error: "path traversal blocked" });
        return;
      }
      if (msg.is_dir) {
        fs.mkdirSync(filePath, { recursive: true });
      } else {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(filePath)) {
          send({ type: "proxy_file_create_result", request_id: msg.request_id, path: msg.path, error: "already exists" });
          return;
        }
        fs.writeFileSync(filePath, "", "utf8");
      }
      send({ type: "proxy_file_create_result", request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: "proxy_file_create_result", request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }
  if (msg.type === "proxy_file_delete") {
    try {
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: "proxy_file_delete_result", request_id: msg.request_id, error: "path traversal blocked" });
        return;
      }
      if (!fs.existsSync(filePath)) {
        send({ type: "proxy_file_delete_result", request_id: msg.request_id, path: msg.path, error: "not found" });
        return;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
      send({ type: "proxy_file_delete_result", request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: "proxy_file_delete_result", request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }
  if (msg.type === "proxy_file_rename") {
    try {
      if (/[<>"|?*]/.test(msg.path) || /[<>"|?*]/.test(msg.new_path)) {
        send({ type: "proxy_file_rename_result", request_id: msg.request_id, error: "invalid characters in path" });
        return;
      }
      const oldPath = path.resolve(msg.workdir, msg.path);
      const newPath = path.resolve(msg.workdir, msg.new_path);
      if (!isPathSafe(oldPath, msg.workdir) || !isPathSafe(newPath, msg.workdir)) {
        send({ type: "proxy_file_rename_result", request_id: msg.request_id, error: "path traversal blocked" });
        return;
      }
      if (!fs.existsSync(oldPath)) {
        send({ type: "proxy_file_rename_result", request_id: msg.request_id, error: "source not found" });
        return;
      }
      if (fs.existsSync(newPath)) {
        send({ type: "proxy_file_rename_result", request_id: msg.request_id, error: "target already exists" });
        return;
      }
      const dir = path.dirname(newPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(oldPath, newPath);
      send({ type: "proxy_file_rename_result", request_id: msg.request_id, path: msg.path, new_path: msg.new_path, ok: true });
    } catch (e) {
      send({ type: "proxy_file_rename_result", request_id: msg.request_id, error: e.message });
    }
  }
  if (msg.type === "search_result" || msg.type === "get_message_result") {
    const pending = pendingRequests.get(msg.request_id);
    if (pending) {
      pendingRequests.delete(msg.request_id);
      pending.resolve(msg);
    }
  }
  if (msg.type === "reauth_request") {
    if (reauthProc) {
      return;
    }
    const { spawn } = require("child_process");
    const URL_REGEX = /https:\/\/claude\.com\/cai\/oauth\/[^\s]+/;
    let urlSent = false;
    reauthProc = spawn("claude", ["auth", "login"], { stdio: ["pipe", "pipe", "pipe"] });
    const onData = (chunk) => {
      if (urlSent) return;
      const match = chunk.toString().match(URL_REGEX);
      if (match) {
        urlSent = true;
        send({ type: "reauth_url", url: match[0] });
      }
    };
    reauthProc.stdout.on("data", onData);
    reauthProc.stderr.on("data", onData);
    reauthProc.on("close", (code) => {
      reauthProc = null;
      send({ type: "reauth_complete", success: code === 0, code });
    });
    reauthProc.on("error", (err) => {
      reauthProc = null;
      send({ type: "reauth_complete", success: false, code: -1, error: err.message });
    });
    return;
  }
  if (msg.type === "reauth_code") {
    if (reauthProc?.stdin?.writable) reauthProc.stdin.write((msg.code || "") + "\n");
    return;
  }
  if (msg.type === "cleanup_session") {
    deleteSessionFile(msg.workdir, msg.claude_session_id);
    return;
  }
  if (msg.type === "claude_md_import") {
    const workdir = msg.workdir;
    const resolved = path.resolve(expandHome(workdir));
    if (!knownWorkdirs.has(resolved)) {
      send({ type: "claude_md_import_result", workdir, error: "workdir not registered" });
      return;
    }
    const claudeMd = path.join(resolved, "CLAUDE.md");
    try {
      if (!fs.existsSync(claudeMd)) {
        send({ type: "claude_md_import_result", workdir, content: "", tracked: false, size: 0 });
        return;
      }
      const content = fs.readFileSync(claudeMd, "utf8");
      let tracked = false;
      try {
        const { spawnSync: spawnSync2 } = require("child_process");
        const result = spawnSync2("git", ["ls-files", "--error-unmatch", "CLAUDE.md"], { cwd: resolved, encoding: "utf8", timeout: 5e3 });
        tracked = result.status === 0;
      } catch {
      }
      send({ type: "claude_md_import_result", workdir, content, tracked, size: Buffer.byteLength(content) });
    } catch (err) {
      send({ type: "claude_md_import_result", workdir, error: err.message });
    }
    return;
  }
  if (msg.type === "claude_md_clear") {
    const workdir = msg.workdir;
    const resolved = path.resolve(expandHome(workdir));
    if (!knownWorkdirs.has(resolved)) {
      send({ type: "claude_md_clear_result", workdir, error: "workdir not registered" });
      return;
    }
    const claudeMd = path.join(resolved, "CLAUDE.md");
    try {
      let tracked = false;
      try {
        const { spawnSync: spawnSync2 } = require("child_process");
        const result = spawnSync2("git", ["ls-files", "--error-unmatch", "CLAUDE.md"], { cwd: resolved, encoding: "utf8", timeout: 5e3 });
        tracked = result.status === 0;
      } catch {
      }
      if (tracked) {
        send({ type: "claude_md_clear_result", workdir, error: "CLAUDE.md is git-tracked, refusing to clear" });
        return;
      }
      fs.writeFileSync(claudeMd, "", "utf8");
      send({ type: "claude_md_clear_result", workdir, ok: true });
    } catch (err) {
      send({ type: "claude_md_clear_result", workdir, error: err.message });
    }
    return;
  }
  if (msg.type === "compact_trigger") {
    const workdir = msg.workdir || process.env.STOA_WORK_DIR || os.homedir();
    const workdirResolved = path.resolve(workdir);
    const key = buildSessionKey(workdirResolved, msg.room_id || "default", msg.thread_id, msg.sub_agent_id);
    let session = sessionPool.get(key);
    if (!session) {
      if (msg.claude_session_id) {
        session = new ClaudeSession({ workDir: workdirResolved, flags: ["--resume", msg.claude_session_id], resumeId: msg.claude_session_id });
        attachUnsolicitedHandler(session, key);
        sessionPool.set(key, session);
        startSessionIdleTimer(key);
        console.log(`[stoa] compact: resuming session ${msg.claude_session_id.slice(0, 8)}... for ${key}`);
      } else {
        console.log(`[stoa] compact: no session for ${key}`);
        send({ type: "compact_error", room_id: msg.room_id, thread_id: msg.thread_id || null, sub_agent_id: msg.sub_agent_id || null, error: "no active session" });
        return;
      }
    }
    if (!supportsCompact(session._harness)) {
      console.log(`[stoa] compact: skipping non-claude session (${session._harness}) for ${key}`);
      send({ type: "compact_error", room_id: msg.room_id, thread_id: msg.thread_id || null, sub_agent_id: msg.sub_agent_id || null, error: `compact not supported for ${session._harness} harness` });
      return;
    }
    console.log(`[stoa] compact: starting for ${key}`);
    compactWithTimeout(session).then((result) => {
      console.log(`[stoa] compact: done for ${key}`);
      send({ type: "compact_complete", room_id: msg.room_id, thread_id: msg.thread_id || null, sub_agent_id: msg.sub_agent_id || null, result: result?.content || "", claude_session_id: result?.sessionId || null });
      setTimeout(() => {
        truncateSessionFile(key, msg.claude_session_id);
        if (result?.sessionId && result.sessionId !== msg.claude_session_id) {
          truncateSessionFile(key, result.sessionId);
        }
      }, 3e3);
    }).catch((err) => {
      console.error(`[stoa] compact error: ${err.message}`);
      send({ type: "compact_error", room_id: msg.room_id, thread_id: msg.thread_id || null, sub_agent_id: msg.sub_agent_id || null, error: err.message });
    });
    return;
  }
  if (msg.type === "agent_trigger") {
    const { room_id, message_id, prompt } = msg;
    console.log(`[stoa] trigger received room=${room_id} msg=${message_id} prompt="${prompt?.slice(0, 60)}..." (active=${activeTriggers.size}/${MAX_CONCURRENT})`);
    if (!canStartTrigger(msg)) {
      triggerQueue.push(msg);
      console.log(`[stoa] queued msg=${message_id} (${triggerQueue.length} in queue)`);
      sendQueueStatus();
      return;
    }
    runTrigger(msg);
    sendQueueStatus();
  }
}
function wsRequest(type, payload, timeout = 1e4) {
  const request_id = String(++requestIdCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(request_id);
      reject(new Error("ws request timeout"));
    }, timeout);
    pendingRequests.set(request_id, { resolve: (msg) => {
      clearTimeout(timer);
      resolve(msg);
    } });
    send({ type, request_id, ...payload });
  });
}
async function getMessage(messageId) {
  const res = await wsRequest("agent_get_message", { message_id: messageId });
  return res.message || null;
}
function classifyModelError(m = "") {
  if (/401|403|unauthorized|invalid[ _-]?api[ _-]?key|authentication|quota|payment|billing|insufficient|credit/i.test(m)) return "provider";
  if (/429|rate[ _-]?limit|overloaded|too many requests|529|503|capacity|timeout|timed out/i.test(m)) return "model";
  return "other";
}
function triggerWorkdir(msg) {
  return msg.workdir || (msg.sub_agent ? path.join(os.homedir(), "stoa-agent") : null) || process.env.STOA_WORK_DIR || os.homedir();
}
function triggerSessionKey(msg) {
  return buildSessionKey(triggerWorkdir(msg), msg.room_id, msg.thread_id || 0, msg.sub_agent?.id);
}
// A session (= one thread of one participant/sub-agent) runs one turn at a time. Without this,
// a second trigger for a busy thread would share — and on a model/env/prompt change, shut down —
// the session the first one is still using, with its first-token watchdog ticking while it waits.
function canStartTrigger(msg) {
  if (activeTriggers.size >= MAX_CONCURRENT) return false;
  const key = triggerSessionKey(msg);
  for (const t of activeTriggers.values()) if (t.sessionKey === key) return false;
  return true;
}
function sendQueueStatus() {
  send({ type: "agent_queue_status", queued: triggerQueue.map((t) => t.message_id), running: [...activeTriggers.keys()], max_concurrent: MAX_CONCURRENT });
}
async function processTrigger(msg) {
  const { room_id, message_id } = msg;
  const subAgent = msg.sub_agent || null;
  const subAgentDefaultWorkdir = path.join(os.homedir(), "stoa-agent");
  const workdir = triggerWorkdir(msg);
  if (!fs.existsSync(workdir)) {
    if (subAgent && workdir === subAgentDefaultWorkdir) {
      fs.mkdirSync(workdir, { recursive: true });
    } else {
      console.error(`[trigger] workdir does not exist on this machine: ${workdir}`);
      send({ type: "agent_complete", room_id, message_id, content: `Workdir tidak ditemukan di mesin ini: \`${workdir}\``, ai_model: void 0, result_meta: { exit_reason: "error" } });
      return;
    }
  }
  const targetDir = path.resolve(workdir);
  const threadId = msg.thread_id || 0;
  const sessionKey = buildSessionKey(targetDir, room_id, threadId, subAgent?.id);
  const entry = { workdir, session: null, sessionKey, room_id, startedAt: Date.now(), lastActivity: Date.now() };
  activeTriggers.set(message_id, entry);
  let sessionRef = null;
  let statusHandler = null;
  let hangWatchdog = null;
  let _toolStatusTimer = null;
  let _toolStartMs = null;
  let _toolVerb = null;
  let _toolStatusUpdates = 0;
  let _saLabel = null;
  let toolMode = "full";
  let lastActivity = Date.now();
  const updateActivity = () => {
    lastActivity = Date.now();
    entry.lastActivity = Date.now();
  };
  try {
  const baseUrl = STOA_URL.replace("ws://", "http://").replace("wss://", "https://");
  const TEXT_EXTS = /* @__PURE__ */ new Set([".md", ".txt", ".json", ".csv", ".html", ".js", ".ts", ".py", ".yaml", ".yml", ".sh", ".css"]);
  const IMAGE_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
  let finalPrompt = msg.prompt;
  if (msg.reply_to) {
    try {
      const replied = await getMessage(msg.reply_to);
      if (replied && replied.content) {
        const chain = [];
        if (replied.reply_to) {
          const parent = await getMessage(replied.reply_to);
          if (parent && parent.content) chain.push(`[${parent.actor_name}]: ${parent.content}`);
        }
        chain.push(`[${replied.actor_name}]: ${replied.content}`);
        finalPrompt += `

--- Replied message (full) ---
${chain.join("\n")}
---`;
      }
    } catch (err) {
      console.error("[stoa] failed to fetch reply chain:", err.message);
    }
  }
  finalPrompt = await prependSkills(finalPrompt, msg.skills);
  const allAttachments = msg.attachments || [];
  if (!allAttachments.length) {
    if (msg.imageUrl) allAttachments.push({ url: msg.imageUrl, name: "", type: "image" });
    if (msg.fileUrl) allAttachments.push({ url: msg.fileUrl, name: msg.fileName || "", type: "file" });
  }
  const localFiles = [];
  const tempDir = path.join(workdir, ".stoa-attachments", String(message_id));
  if (allAttachments.length) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch {
    }
  }
  const attachmentNotes = [];
  const usedNames = new Set();
  for (const att of allAttachments) {
    const url = att.url?.startsWith("http") ? att.url : baseUrl + att.url;
    const ext = path.extname(att.name || att.url || "").toLowerCase();
    let safeName = (att.name || path.basename(att.url || "file")).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (usedNames.has(safeName)) {
      const base = safeName.replace(/(\.[^.]+)$/, "");
      const sfx = safeName.match(/(\.[^.]+)$/)?.[1] || "";
      let n = 1;
      while (usedNames.has(`${base}-${n}${sfx}`)) n++;
      safeName = `${base}-${n}${sfx}`;
    }
    usedNames.add(safeName);
    const displayName = att.name || safeName;
    if (att.type === "image" || IMAGE_EXTS.has(ext)) {
      try {
        const localPath = path.join(tempDir, safeName);
        await fetchToFile(url, localPath);
        localFiles.push({ name: displayName, path: localPath, type: "image" });
      } catch (err) {
        console.error("[stoa] image download failed:", att.url, err.message);
        attachmentNotes.push(`- ${displayName}: [gagal didownload \u2014 tidak tersedia]`);
      }
    } else if (TEXT_EXTS.has(ext)) {
      try {
        const text = await fetchText(url);
        if (!text || !text.trim()) {
          attachmentNotes.push(`- ${displayName}: [file kosong]`);
        } else {
          finalPrompt = `${finalPrompt}

---
Isi file \`${displayName}\`:
\`\`\`
${text}
\`\`\``;
        }
      } catch (err) {
        console.error("[stoa] file fetch failed:", att.url, err.message);
        attachmentNotes.push(`- ${displayName}: [gagal difetch \u2014 tidak tersedia]`);
      }
    } else {
      try {
        const localPath = path.join(tempDir, safeName);
        await fetchToFile(url, localPath);
        localFiles.push({ name: displayName, path: localPath, type: "file" });
      } catch (err) {
        console.error("[stoa] file download failed:", att.url, err.message);
        attachmentNotes.push(`- ${displayName}: [gagal didownload \u2014 tidak tersedia]`);
      }
    }
  }
  if (localFiles.length || attachmentNotes.length) {
    const successList = localFiles.map((f) => `- ${f.name}: ${f.path}`);
    const allNotes = [...successList, ...attachmentNotes].join("\n");
    if (msg.tools_supported === false) {
      finalPrompt += `

---
File yang dilampirkan:
${allNotes}`;
    } else {
      finalPrompt += `

---
File yang dilampirkan (sudah didownload ke lokal, gunakan Read tool untuk membaca/melihat):
${allNotes}`;
    }
  }
    let _stopToolTimer2 = function() {
      if (_toolStatusTimer) {
        clearInterval(_toolStatusTimer);
        _toolStatusTimer = null;
      }
      _toolStartMs = null;
      _toolVerb = null;
      _toolStatusUpdates = 0;
    }, _clearToolStatus2 = function() {
      const hadVerb = !!_toolVerb;
      _stopToolTimer2();
      if (hadVerb && toolMode !== "off") send({ type: "agent_system_event", room_id, message_id, status: null, sub_agent_label: _saLabel });
    }, _startToolStatus2 = function(verb) {
      _stopToolTimer2();
      if (toolMode === "off") return;
      _toolVerb = verb;
      _toolStartMs = Date.now();
      _toolStatusUpdates = 0;
      send({ type: "agent_system_event", room_id, message_id, status: verb, sub_agent_label: _saLabel });
      _toolStatusTimer = setInterval(() => {
        if (_toolStatusUpdates >= 2) {
          clearInterval(_toolStatusTimer);
          return;
        }
        const elapsed = Math.round((Date.now() - _toolStartMs) / 1e3);
        send({ type: "agent_system_event", room_id, message_id, status: `${_toolVerb} \xB7 ${elapsed}s`, sub_agent_label: _saLabel });
        _toolStatusUpdates++;
      }, 1e4);
    }, _toolVerb_for2 = function(toolName, input) {
      const firstArg = () => {
        const v = Object.values(input || {})[0];
        return typeof v === "string" ? v : null;
      };
      const cap = (s) => s && s.length > 50 ? s.slice(0, 50) + "\u2026" : s || "";
      const verbMap = {
        Read: () => toolMode === "verb" ? "membaca file\u2026" : `membaca ${cap(input.file_path || firstArg())}\u2026`,
        Edit: () => toolMode === "verb" ? "menulis file\u2026" : `menulis ${cap(input.file_path || firstArg())}\u2026`,
        Write: () => toolMode === "verb" ? "menulis file\u2026" : `menulis ${cap(input.file_path || firstArg())}\u2026`,
        Bash: () => "menjalankan perintah\u2026",
        Agent: () => "mendelegasikan ke sub-agent\u2026"
      };
      return (verbMap[toolName] || (() => `menggunakan ${toolName}\u2026`))();
    };
    var _stopToolTimer = _stopToolTimer2, _clearToolStatus = _clearToolStatus2, _startToolStatus = _startToolStatus2, _toolVerb_for = _toolVerb_for2;
    const rid = msg.claude_session_id || null;
    if (msg.workdir) {
      try {
        fs.mkdirSync(msg.workdir, { recursive: true });
        const claudeMd = path.join(msg.workdir, "CLAUDE.md");
        if (!fs.existsSync(claudeMd)) {
          fs.writeFileSync(claudeMd, "", "utf8");
        }
      } catch {
      }
    }
    if (entry.swept) throw new Error('trigger swept by stale cleanup');
    const triggerHarness = msg.harness || "claude";
    const apiKeys = msg.api_keys || (msg.api_key ? [msg.api_key] : []);
    const platformEnv = { STOA_ROOM_ID: String(room_id), STOA_THREAD_ID: threadId ? String(threadId) : "" };
    const proxy = cfProxyReady ? await cfProxyReady : null;
    if (proxy) platformEnv.STOA_URL = proxy.wsUrl;
    // MCP gateway: the token goes in env only; claude-session / codex-session reference it by name.
    // MCP_TOOL_TIMEOUT (Claude Code reads it; codex-session maps it to tool_timeout_sec) must outlast a
    // call held for owner approval: gateway cap 10 min (APPROVAL_TIMEOUT_MAX_MS) + 60 s call timeout.
    if (msg.mcp_token) {
      platformEnv.STOA_MCP_TOKEN = msg.mcp_token;
      platformEnv.STOA_MCP_URL = (proxy ? proxy.httpUrl : STOA_URL.replace(/^ws/, "http")).replace(/\/+$/, "") + "/mcp";
      platformEnv.MCP_TOOL_TIMEOUT = String(MCP_TOOL_TIMEOUT_MS);
    }
    if (triggerHarness === "claude") {
      // The Stoa Ollama proxy sits behind Cloudflare Access too — route it through the loopback proxy.
      if (msg.base_url) platformEnv.ANTHROPIC_BASE_URL = proxy && httpOrigin(msg.base_url) === httpOrigin(STOA_URL) ? proxy.httpUrl : msg.base_url;
      if (apiKeys[0]) platformEnv.ANTHROPIC_AUTH_TOKEN = apiKeys[0];
    }
    const envToUse = platformEnv;
    const systemPromptHash = msg.system_prompt_hash || null;
    const resumeBase = buildResumeArgs(msg, { targetDir, sessionKey, harness: triggerHarness });
    let session = (_getSessionOverride || getSession)(targetDir, room_id, envToUse, subAgent?.id, threadId, msg.system_prompt, systemPromptHash, triggerHarness);
    const currentSystemPromptHash = session._systemPromptHash || null;
    const needsSystemPromptChange = systemPromptHash && currentSystemPromptHash !== systemPromptHash;
    const needsResume = rid && session.resumeId !== rid;
    const needsFreshSession = !rid && session.resumeId;
    const needsHarnessChange = (session._harness || "claude") !== triggerHarness;
    let targetModel = msg.model || null;
    const modelChain = Array.isArray(msg.models) && msg.models.length ? msg.models.slice() : targetModel ? [targetModel] : [];
    let modelIdx = 0;
    const currentModel = session.flags?.find((f, i, arr) => arr[i - 1] === "--model") || null;
    const needsModelChange = targetModel && currentModel !== targetModel;
    const currentEnv = JSON.stringify(session.env || {});
    const newEnv = JSON.stringify(envToUse || {});
    const needsEnvChange = currentEnv !== newEnv;
    if (needsResume || needsFreshSession || needsModelChange || needsEnvChange || needsSystemPromptChange || needsHarnessChange) {
      warnBackgroundKill(session, `session restart (${[needsResume && "resume", needsFreshSession && "fresh", needsModelChange && "model", needsEnvChange && "env", needsSystemPromptChange && "system_prompt", needsHarnessChange && "harness"].filter(Boolean).join(",")}) msg=${message_id}`, sessionKey);
      session.shutdown();
      session = await (_prepareResumeOverride || prepareResume)({ ...resumeBase, rid: needsHarnessChange ? null : rid, targetModel, env: envToUse });
      console.log(`[stoa] Session restarted: harness=${triggerHarness} workdir=${targetDir} room=${room_id} thread=${threadId}${rid ? " resume=" + rid.slice(0, 8) + "..." : " (fresh)"}${targetModel ? " model=" + targetModel : ""}${needsSystemPromptChange ? " system_prompt_changed" : ""}${needsHarnessChange ? " harness_changed" : ""}${msg.base_url ? " base_url=" + msg.base_url : ""}${msg.tools_supported === false ? " tools=disabled" : ""}`);
    }
    if (entry.swept) throw new Error('trigger swept by stale cleanup');
    Object.assign(entry, { workdir: targetDir, session, lastActivity: Date.now() });
    let fullContent = "";
    let abortReason = null;
    let thinkingSigRetried = false;
    statusHandler = (status) => {
      updateActivity();
      send({ type: "agent_system_event", room_id, message_id, status });
    };
    sessionRef = session;
    session.on("status", statusHandler);
    const DEBUG_ACTIVE_GRACE_MS = 6e4;
    const MAX_DEBUG_DEFERS = 3;
    let debugDeferCount = 0;
    hangWatchdog = setInterval(() => {
      const timeout = idleLimit(entry, fullContent ? TRIGGER_TIMEOUT : FIRST_TOKEN_TIMEOUT);
      if (Date.now() - lastActivity > timeout) {
        if (session.debugLogPath && debugDeferCount < MAX_DEBUG_DEFERS) {
          try {
            const { mtimeMs } = fs.statSync(session.debugLogPath);
            if (Date.now() - mtimeMs < DEBUG_ACTIVE_GRACE_MS) {
              debugDeferCount++;
              updateActivity();
              console.log(`[stoa] watchdog: CLI debug log active ${Math.round((Date.now() - mtimeMs) / 1e3)}s ago, deferring abort (${debugDeferCount}/${MAX_DEBUG_DEFERS})`);
              return;
            }
          } catch {
          }
        }
        clearInterval(hangWatchdog);
        abortReason = "timeout";
        console.error(`[stoa] trigger timeout (${timeout / 1e3}s ${fullContent ? "idle" : "no first token"}), aborting msg=${message_id} ${sessionKey}`);
        warnBackgroundKill(session, `watchdog timeout msg=${message_id}`, sessionKey);
        session.cancelTask(message_id);
      }
    }, 1e4);
    toolMode = roomSettings.get(room_id)?.tool_status_mode ?? "full";
    _saLabel = subAgent?.label || null;
    const sendOpts = {
      prompt: finalPrompt,
      history: msg.rawHistory || null,
      taskId: message_id,
      onToken: (token) => {
        updateActivity();
        entry.toolInFlight = false;
        fullContent += token;
        send({ type: "agent_token", room_id, message_id, token });
        if (_toolStatusTimer) _stopToolTimer2();
      },
      onState: (state) => {
        updateActivity();
        send({ type: "agent_state", room_id, message_id, state });
        if (_toolStatusTimer) _stopToolTimer2();
      },
      // The session layer surfaces tool_use but not tool_result, so a tool counts as in
      // flight until the model streams text again (it only does once every result is in).
      onTool: (tool) => {
        updateActivity();
        entry.toolInFlight = true;
        send({ type: "agent_tool", room_id, message_id, tool });
        _startToolStatus2(_toolVerb_for2(tool.name, tool.input));
      }
    };
    const _checkSwept = () => {
      if (entry.swept) throw new Error('trigger swept by stale cleanup');
    };
    const _updateEntry = (fields) => {
      Object.assign(entry, fields);
    };
    let result;
    try {
      _checkSwept();
      result = await session.send(sendOpts);
    } catch (retryErr) {
      const isAuthOrQuota = /auth|unauthorized|quota|rate.limit|429|401|403/i.test(retryErr.message);
      if (classifyModelError(retryErr.message) === "model" && !fullContent && modelIdx < modelChain.length - 1) {
        let advanced = false;
        let lastErr = retryErr;
        while (modelIdx < modelChain.length - 1) {
          const failed = modelChain[modelIdx];
          modelIdx++;
          targetModel = modelChain[modelIdx];
          console.log(`[stoa] model "${failed}" unavailable (${lastErr.message}), falling back to "${targetModel}"`);
          send({ type: "agent_stream_reset", room_id, message_id });
          fullContent = "";
          warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
          session.shutdown();
          session = await (_prepareResumeOverride || prepareResume)({ ...resumeBase, rid, targetModel, env: envToUse });
          _updateEntry({ session, lastActivity: Date.now() });
          sessionRef = session;
          session.on("status", statusHandler);
          try {
            updateActivity();
            _checkSwept();
            result = await session.send(sendOpts);
            advanced = true;
            break;
          } catch (e2) {
            lastErr = e2;
            if (classifyModelError(e2.message) !== "model") break;
          }
        }
        if (!advanced) throw lastErr;
      } else if (isAuthOrQuota && apiKeys.length > 1 && !fullContent) {
        let rotated = false;
        for (let ki = 1; ki < apiKeys.length; ki++) {
          console.log(`[stoa] API key #1 failed (${retryErr.message}), rotating to key #${ki + 1}...`);
          const rotatedEnv = { ...platformEnv, ANTHROPIC_AUTH_TOKEN: apiKeys[ki] };
          warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
          session.shutdown();
          session = await (_prepareResumeOverride || prepareResume)({ ...resumeBase, rid, targetModel, env: rotatedEnv });
          _updateEntry({ session, lastActivity: Date.now() });
          sessionRef = session;
          session.on("status", statusHandler);
          try {
            updateActivity();
            _checkSwept();
            result = await session.send(sendOpts);
            rotated = true;
            break;
          } catch (e2) {
            if (ki === apiKeys.length - 1) throw new Error(`All ${apiKeys.length} API keys exhausted. Last error: ${e2.message}`);
          }
        }
        if (!rotated) throw retryErr;
      } else if (isAuthOrQuota && !fullContent) {
        console.log(`[stoa] OAuth/auth error (${retryErr.message}), killing session and retrying fresh...`);
        send({ type: "agent_stream_reset", room_id, message_id });
        warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
        session.shutdown();
        sessionPool.delete(sessionKey);
        await new Promise((r) => setTimeout(r, 2e3));
        fullContent = "";
        session = (_getSessionOverride || getSession)(targetDir, room_id, envToUse, subAgent?.id, threadId, msg.system_prompt, systemPromptHash, triggerHarness);
        _updateEntry({ session, lastActivity: Date.now() });
        if (statusHandler) session.on("status", statusHandler);
        sessionRef = session;
        updateActivity();
        _checkSwept();
        result = await session.send(sendOpts);
      } else if (retryErr.message.includes("exited unexpectedly") && !fullContent) {
        console.log(`[stoa] session crashed before output, retrying in 4s...`);
        await new Promise((r) => setTimeout(r, 4e3));
        _checkSwept();
        session = (_getSessionOverride || getSession)(targetDir, room_id, envToUse, subAgent?.id, threadId, msg.system_prompt, systemPromptHash, triggerHarness);
        _updateEntry({ session, lastActivity: Date.now() });
        updateActivity();
        result = await session.send(sendOpts);
      } else if (triggerHarness === "claude" && isThinkingSignatureError(retryErr.message) && !fullContent && !thinkingSigRetried) {
        thinkingSigRetried = true;
        console.log(`[stoa] thinking-signature 400 detected (exception): ${retryErr.message.slice(0, 120)}`);
        send({ type: "agent_stream_reset", room_id, message_id });
        fullContent = "";
        warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
        session.shutdown();
        await backupSessionFile(targetDir, rid);
        session = await (_prepareResumeOverride || prepareResume)({ ...resumeBase, rid, targetModel, env: envToUse, aggressive: true });
        _updateEntry({ session, lastActivity: Date.now() });
        sessionRef = session;
        session.on("status", statusHandler);
        updateActivity();
        _checkSwept();
        result = await session.send(sendOpts);
      } else {
        throw retryErr;
      }
    }
    let { content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype, isError } = result;
    content = stripLeadingThinkingMarker(content);
    const AUTH_EXPIRED_RE = /not logged in|please run \/(reauth|login)/i;
    if (triggerHarness === "claude" && !aborted && AUTH_EXPIRED_RE.test(content) && content.length < 200) {
      console.log(`[stoa] OAuth expired detected in room=${room_id} msg=${message_id}, content="${content.slice(0, 100)}"`);
      console.log(`[stoa] Killing session and retrying...`);
      send({ type: "agent_stream_reset", room_id, message_id });
      warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
      session.shutdown();
      sessionPool.delete(sessionKey);
      await new Promise((r) => setTimeout(r, 2e3));
      fullContent = "";
      session = (_getSessionOverride || getSession)(targetDir, room_id, envToUse, subAgent?.id, threadId, msg.system_prompt, systemPromptHash, triggerHarness);
      _updateEntry({ session, lastActivity: Date.now() });
      if (statusHandler) session.on("status", statusHandler);
      sessionRef = session;
      updateActivity();
      _checkSwept();
      result = await session.send(sendOpts);
      ({ content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype, isError } = result);
      content = stripLeadingThinkingMarker(content);
      console.log(`[stoa] OAuth retry completed for room=${room_id} msg=${message_id}, content=${content.length} chars`);
    }
    if (triggerHarness === "claude" && !aborted && !thinkingSigRetried && isThinkingSignatureError(content)) {
      thinkingSigRetried = true;
      console.log(`[stoa] thinking-signature 400 detected (content): ${content.slice(0, 120)}`);
      send({ type: "agent_stream_reset", room_id, message_id });
      fullContent = "";
      warnBackgroundKill(session, `error-recovery restart msg=${message_id}`, sessionKey);
      session.shutdown();
      await backupSessionFile(targetDir, rid);
      session = await (_prepareResumeOverride || prepareResume)({ ...resumeBase, rid, targetModel, env: envToUse, aggressive: true });
      _updateEntry({ session, lastActivity: Date.now() });
      if (statusHandler) session.on("status", statusHandler);
      sessionRef = session;
      updateActivity();
      _checkSwept();
      result = await session.send(sendOpts);
      ({ content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype, isError } = result);
      content = stripLeadingThinkingMarker(content);
      console.log(`[stoa] thinking-signature recovery ${isThinkingSignatureError(content) ? "FAILED" : "ok"} for room=${room_id} msg=${message_id}`);
    }
    clearInterval(hangWatchdog);
    consecutiveTriggerErrors = 0;
    if (aborted) {
      const effectiveReason = abortReason || entry.abortReason || null;
      if (entry.completedBySweep) {
        console.log(`[stoa] Swept message ${message_id}, skipping agent_complete (sweep already sent it)`);
      } else {
        const partial = stripLeadingThinkingMarker(fullContent) || content || "";
        const isTimeout = effectiveReason === "timeout" || effectiveReason === "stale";
        const fallback = isTimeout ? "(timed out \u2014 no activity)" : "(stopped by user)";
        const result_meta = { exit_reason: isTimeout ? "timeout" : "stopped", tokens: null, duration_ms: null };
        send({ type: "agent_complete", room_id, message_id, content: partial || fallback, ai_model: targetModel || void 0, result_meta });
        console.log(`[stoa] Aborted message ${message_id}, reason=${effectiveReason || "user"}, partial=${partial.length} chars`);
      }
    } else {
      if (!content.trim()) console.warn(`[stoa] empty result from ${triggerHarness}: msg=${message_id} subtype=${subtype || ""} ${sessionKey}`);
      const { text: cleanContent, attachments } = await extractAndUploadFiles(content, msg.workdir);
      const actualModel = targetModel || modelUsage && Object.keys(modelUsage).find((k) => k !== "total") || void 0;
      const result_meta = {
        exit_reason: isError || subtype && subtype !== "success" ? "error" : "completed",
        tokens: usage ? { input: usage.input_tokens || 0, output: usage.output_tokens || 0 } : null,
        duration_ms: durationMs || null
      };
      const completeMsg = { type: "agent_complete", room_id, message_id, content: cleanContent || (attachments.length ? "\u{1F4CE}" : cleanContent), claude_session_id: sessionId, ai_model: actualModel, result_meta };
      if (attachments.length === 1) {
        completeMsg.file_url = attachments[0].url;
        completeMsg.file_name = attachments[0].name;
      } else if (attachments.length > 1) {
        completeMsg.attachments = attachments;
      }
      send(completeMsg);
      if (usage || modelUsage) {
        send({ type: "usage_report", room_id, message_id, actor_id: ACTOR_ID, model: targetModel || "unknown", usage: usage || {}, modelUsage: modelUsage || {}, totalCostUsd: totalCostUsd || 0 });
      }
      if (triggerHarness === "claude" && sessionId && targetDir && !compactsInFlight.has(sessionKey)) {
        await stripSessionImages(targetDir, sessionId);
      }
      const sessionIdForCompact = sessionId;
      if (triggerHarness === "claude" && sessionIdForCompact && targetDir) {
        setImmediate(async () => {
          const fileSize = await getSessionFileSize(targetDir, sessionIdForCompact);
          if (fileSize <= AUTO_COMPACT_THRESHOLD) return;
          if (compactsInFlight.has(sessionKey)) return;
          const sess = sessionPool.get(sessionKey);
          if (!sess) return;
          console.log(`[stoa] session ${sessionIdForCompact.slice(0, 8)}... is ${(fileSize / 1024).toFixed(0)}KB > ${AUTO_COMPACT_THRESHOLD / 1024}KB threshold, auto-compacting`);
          compactsInFlight.add(sessionKey);
          const postRunMeta = parseSessionKey(sessionKey);
          send({ type: "auto_compact_start", room_id, claude_session_id: sessionIdForCompact, thread_id: postRunMeta.threadId, sub_agent_id: postRunMeta.subAgentId });
          compactWithTimeout(sess).then((result2) => {
            compactsInFlight.delete(sessionKey);
            if (result2?.sessionId) sess.resumeId = result2.sessionId;
            send({ type: "compact_complete", room_id, result: result2?.content || "", claude_session_id: result2?.sessionId || sessionIdForCompact, orig_session_id: sessionIdForCompact, thread_id: postRunMeta.threadId, sub_agent_id: postRunMeta.subAgentId });
            setTimeout(() => {
              truncateSessionFile(targetDir, sessionIdForCompact);
              if (result2?.sessionId && result2.sessionId !== sessionIdForCompact) truncateSessionFile(targetDir, result2.sessionId);
            }, 3e3);
          }).catch((err) => {
            compactsInFlight.delete(sessionKey);
            console.error(`[stoa] auto-compact error: ${err.message}`);
            send({ type: "compact_error", room_id, thread_id: postRunMeta.threadId, sub_agent_id: postRunMeta.subAgentId, error: err.message });
          });
        });
      }
    }
  } catch (err) {
    if (entry.completedBySweep) {
      console.log(`[stoa] trigger ${message_id} swept during processing, suppressing error`);
    } else if (entry.swept) {
      const isTimeout = entry.abortReason === "timeout" || entry.abortReason === "stale";
      const fallback = isTimeout ? "(timed out — no activity)" : "(stopped by user)";
      const result_meta = { exit_reason: isTimeout ? "timeout" : "stopped" };
      send({ type: "agent_complete", room_id, message_id, content: fallback, result_meta });
      console.log(`[stoa] trigger ${message_id} swept, sending complete from catch`);
    } else {
      consecutiveTriggerErrors++;
      console.error(`[stoa] trigger error (${consecutiveTriggerErrors}/${MAX_TRIGGER_ERRORS}): ${err.message}`);
      send({ type: "agent_error", room_id, message_id, error: err.message });
    }
    if (consecutiveTriggerErrors >= MAX_TRIGGER_ERRORS) {
      console.log("[stoa] too many trigger errors, restarting clean...");
      for (const s of sessionPool.values()) s.shutdown();
      process.exit(0);
    }
  } finally {
    if (hangWatchdog) clearInterval(hangWatchdog);
    try { if (sessionRef && statusHandler) sessionRef.removeListener("status", statusHandler); } catch {}
    try { _clearToolStatus(); } catch {}
    try {
      fs.rmSync(path.join(workdir, ".stoa-attachments", String(message_id)), { recursive: true, force: true });
    } catch {}
    activeTriggers.delete(message_id);
    try { if (targetDir) startSessionIdleTimer(sessionKey); } catch {}
    const steerKey = `${room_id}:${threadId || 0}`;
    const steers = pendingSteerMessages.get(steerKey) || [];
    if (steers.length) {
      pendingSteerMessages.delete(steerKey);
      for (let i = steers.length - 1; i >= 0; i--) {
        const s = steers[i];
        triggerQueue.unshift({ ...msg, message_id: s.message_id, prompt: s.content, attachments: null, reply_to: null });
      }
    }
    drainQueue();
  }
}
async function extractAndUploadFiles(content, workdir) {
  const IMAGE_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
  const matches = [...content.matchAll(/\[send:([^\]]+)\]/g)];
  if (!matches.length) return { text: content, attachments: [] };
  let text = content;
  for (const m of matches) text = text.replace(m[0], "");
  text = text.trim();
  const baseUrl = STOA_URL.replace("ws://", "http://").replace("wss://", "https://");
  const mimeMap = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".py": "text/x-python",
    ".html": "text/html",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".sh": "text/x-shellscript",
    ".sql": "text/x-sql",
    ".xml": "application/xml"
  };
  const attachments = [];
  const failures = [];
  for (const m of matches) {
    const filePath = m[1].trim();
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workdir || ".", filePath);
    const fileName = path.basename(resolved);
    let stat = null;
    try {
      stat = fs.statSync(resolved);
    } catch {
    }
    if (!stat?.isFile()) {
      console.warn(`[stoa] send file not found: ${resolved}`);
      failures.push({ name: fileName, reason: "file tidak ditemukan" });
      continue;
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
      console.warn(`[stoa] send file too large: ${resolved} (${stat.size} bytes > ${MAX_UPLOAD_BYTES})`);
      failures.push({ name: fileName, reason: `${formatMB(stat.size)} melebihi batas ${MAX_UPLOAD_BYTES / 1048576} MB` });
      continue;
    }
    try {
      const fileData = fs.readFileSync(resolved);
      const ext = path.extname(fileName).toLowerCase();
      const mime = mimeMap[ext] || "application/octet-stream";
      const res = await (_fetchOverride || fetch)(`${baseUrl}/api/upload/raw`, {
        method: "POST",
        headers: {
          "Content-Type": mime,
          "X-File-Name": encodeURIComponent(fileName),
          "X-Agent-Id": String(ACTOR_ID),
          "X-Agent-Secret": STOA_SECRET,
          ...stoaCfHeaders(`${baseUrl}/api/upload/raw`)
        },
        body: fileData
      });
      let result = null;
      try {
        result = await res.json();
      } catch {
      }
      if (!res.ok || typeof result?.url !== "string") {
        const why = result?.error || `HTTP ${res.status}`;
        console.error(`[stoa] file upload rejected: ${fileName} (${stat.size} bytes) status=${res.status} error=${why}`);
        failures.push({ name: fileName, reason: `ditolak server (${why})` });
        continue;
      }
      console.log(`[stoa] uploaded file: ${fileName} \u2192 ${result.url}`);
      attachments.push({ url: result.url, name: result.name || fileName, type: IMAGE_EXTS.has(ext) ? "image" : "file" });
    } catch (err) {
      console.error(`[stoa] file upload failed: ${fileName} (${stat.size} bytes): ${err.message}`);
      failures.push({ name: fileName, reason: `upload gagal (${err.message})` });
    }
  }
  if (failures.length) {
    const notes = failures.map((f) => `\u26A0\uFE0F file ${f.name} gagal dikirim: ${f.reason}`);
    text = [text, ...notes].filter(Boolean).join("\n\n");
  }
  return { text, attachments, failures };
}
// A turn the CLI ran on its own (background task finished while idle) has no Stoa message row,
// so its output goes out as a proactive message in the session's room/thread, under the
// sub-agent's identity when the session belongs to one.
function attachUnsolicitedHandler(session, sessionKey) {
  if (typeof session?.on !== "function") return;
  session.on("unsolicited_result", (result) => {
    postUnsolicitedResult(sessionKey, result).catch((err) => console.error(`[stoa] unsolicited result post failed: ${err.message} ${sessionKey}`));
  });
}
async function postUnsolicitedResult(sessionKey, { content } = {}) {
  const { roomId, threadId, subAgentId } = parseSessionKey(sessionKey);
  const workdir = sessionKey.split("::")[0];
  if (sessionPool.has(sessionKey)) startSessionIdleTimer(sessionKey);
  const raw = stripLeadingThinkingMarker(content || "").trim();
  if (!raw) {
    console.log(`[stoa] unsolicited turn produced no output: ${sessionKey}`);
    return null;
  }
  if (!roomId) {
    console.warn(`[stoa] unsolicited turn output dropped (no room in session key, ${raw.length} chars): ${sessionKey}`);
    return null;
  }
  const { text, attachments } = await extractAndUploadFiles(raw, workdir);
  const body = { content: text || "\u{1F4CE}" };
  if (threadId) body.thread_id = threadId;
  if (subAgentId) body.sub_agent_id = subAgentId;
  if (attachments.length) body.attachments = attachments;
  const baseUrl = STOA_URL.replace("ws://", "http://").replace("wss://", "https://");
  const url = `${baseUrl}/api/rooms/${roomId}/message`;
  const res = await (_fetchOverride || fetch)(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": String(ACTOR_ID),
      "X-Agent-Secret": STOA_SECRET,
      ...stoaCfHeaders(url)
    },
    body: JSON.stringify(body)
  });
  let resBody = null;
  try {
    resBody = await res.json();
  } catch {
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${resBody?.error || ""}`.trim());
  console.log(`[stoa] unsolicited turn output posted: msg=${resBody?.message_id} room=${roomId} thread=${threadId || 0}${subAgentId ? " sub=" + subAgentId : ""} (${text.length} chars, ${attachments.length} file(s))`);
  return resBody?.message_id ?? null;
}
function runTrigger(msg) {
  processTrigger(msg).catch((err) => {
    console.error(`[stoa] unhandled processTrigger error: ${err.message}`);
    activeTriggers.delete(msg.message_id);
    drainQueue();
  });
}
function drainQueue() {
  // FIFO, but a trigger whose thread is still busy stays put and lets later threads pass.
  let i = 0;
  while (activeTriggers.size < MAX_CONCURRENT && i < triggerQueue.length) {
    if (!canStartTrigger(triggerQueue[i])) {
      i++;
      continue;
    }
    const [next] = triggerQueue.splice(i, 1);
    console.log(`[stoa] dequeued msg=${next.message_id} (${triggerQueue.length} remaining, active=${activeTriggers.size}/${MAX_CONCURRENT})`);
    runTrigger(next);
  }
  sendQueueStatus();
  if (activeTriggers.size === 0 && triggerQueue.length === 0 && pendingRestart) doRestart();
}
// STALE_TRIGGER_MS must exceed maximum idle the watchdog can tolerate:
// worst case ≈ FIRST_TOKEN_TIMEOUT (10m) + one watchdog interval (10s) ≈ 10m10s
// (defer resets lastActivity, so defers do NOT extend idle from sweep's perspective).
// Default 20m gives ~10m buffer. Clamped to ≥ FIRST_TOKEN_TIMEOUT + 2×sweep_interval.
// With a tool in flight the watchdog tolerates TOOL_STALL_MS, so staleLimit keeps the
// same two-sweep margin above that — the sweep stays a backstop, never the first cut.
var STALE_SWEEP_INTERVAL_MS = 60e3;
var STALE_TRIGGER_MS = (() => {
  const MIN_STALE = FIRST_TOKEN_TIMEOUT + 2 * STALE_SWEEP_INTERVAL_MS;
  const raw = parseInt(process.env.STALE_TRIGGER_MS || String(20 * 60 * 1000));
  return Math.max(raw, MIN_STALE);
})();
function staleLimit(entry) {
  return Math.max(STALE_TRIGGER_MS, idleLimit(entry, FIRST_TOKEN_TIMEOUT) + 2 * STALE_SWEEP_INTERVAL_MS);
}
function sweepStaleTriggers(now) {
  let forceCleaned = false;
  for (const [msgId, entry] of activeTriggers) {
    if (now - (entry.lastActivity || entry.startedAt || now) > staleLimit(entry)) {
      console.warn(`[stoa] stale trigger swept: msg=${msgId} idle=${Math.round((now - (entry.lastActivity || entry.startedAt)) / 1000)}s`);
      entry.swept = true;
      entry.abortReason = 'stale';
      if (entry.session?.cancelTask) {
        const cancelled = entry.session.cancelTask(msgId);
        if (!cancelled) {
          entry.completedBySweep = true;
          activeTriggers.delete(msgId);
          send({ type: "agent_complete", room_id: entry.room_id, message_id: msgId, content: "(timed out — no activity)", result_meta: { exit_reason: "timeout" } });
          forceCleaned = true;
        }
      } else {
        entry.completedBySweep = true;
        activeTriggers.delete(msgId);
        send({ type: "agent_complete", room_id: entry.room_id, message_id: msgId, content: "(timed out — no activity)", result_meta: { exit_reason: "timeout" } });
        forceCleaned = true;
      }
    }
  }
  if (forceCleaned) drainQueue();
  else if (activeTriggers.size === 0 && triggerQueue.length === 0 && pendingRestart) doRestart();
  else forceRestartIfStalled(now);
}
var FETCH_TIMEOUT_MS = 60000;
function fetchToFile(url, destPath) {
  const http = url.startsWith("https") ? require("https") : require("http");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`fetchToFile timeout: ${url}`)); }, FETCH_TIMEOUT_MS);
    const req = http.get(url, { headers: stoaCfHeaders(url) }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        res.resume();
        reject(new Error(`fetchToFile HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const ws2 = fs.createWriteStream(destPath);
      res.pipe(ws2);
      ws2.on("finish", () => {
        clearTimeout(timer);
        ws2.close();
        resolve(destPath);
      });
      ws2.on("error", (err) => {
        clearTimeout(timer);
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
      res.on("error", (err) => {
        clearTimeout(timer);
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });
    req.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}
function fetchText(url) {
  const http = url.startsWith("https") ? require("https") : require("http");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`fetchText timeout: ${url}`)); }, FETCH_TIMEOUT_MS);
    const req = http.get(url, { headers: stoaCfHeaders(url) }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        res.resume();
        reject(new Error(`fetchText HTTP ${res.statusCode}: ${url}`));
        return;
      }
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => text += c);
      res.on("end", () => { clearTimeout(timer); resolve(text); });
      res.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
    req.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}
// ── Skill cache: ~/.stoa/skills/<name>/<manifest_hash>/ holds one revision of a skill's files. A ".ok"
// marker is written last, so a folder without it is never used. The server already validates every
// path; the checks here are defense in depth, because these files end up next to an agent with a shell.
var DEFAULT_SKILLS_DIR = path.join(os.homedir(), ".stoa", "skills");
var SKILLS_DIR = DEFAULT_SKILLS_DIR;
var SKILL_NAME_RE = /^[a-z][a-z0-9-]{1,47}$/;
var SKILL_HASH_RE = /^[0-9a-f]{64}$/;
var SKILL_VERSIONS_KEPT = 2;
var skillLocks = /* @__PURE__ */ new Map();
function skillManifestHash(files) {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) h.update(`${f.path}
${f.sha256}
${f.size}
${f.mode}
`);
  return h.digest("hex");
}
function skillFilePath(base, rel) {
  if (typeof rel !== "string" || !rel || rel.length > 200 || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || /[\u0000-\u001f]/.test(rel)) return null;
  if (rel.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  const dest = path.join(base, rel);
  return dest.startsWith(base + path.sep) ? dest : null;
}
async function skillHttp(pathname) {
  const baseUrl = STOA_URL.replace("ws://", "http://").replace("wss://", "https://");
  const url = `${baseUrl}${pathname}`;
  const res = await (_fetchOverride || fetch)(url, {
    headers: { "X-Agent-Id": String(ACTOR_ID), "X-Agent-Secret": STOA_SECRET, ...stoaCfHeaders(url) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (res.status === 404) {
    const e = new Error("not found on the server (deleted or disabled)");
    e.gone = true;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
function cachedSkillDirs(root) {
  try {
    return fs.readdirSync(root).filter((d) => SKILL_HASH_RE.test(d) && fs.existsSync(path.join(root, d, ".ok"))).map((d) => {
      const dir = path.join(root, d);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, ".ok"), "utf8")); } catch {}
      return { dir, hash: d, version: meta.version ?? null, at: meta.at || 0 };
    }).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}
// The newest SKILL_VERSIONS_KEPT complete copies stay; older ones and half-written folders go.
function pruneSkillDir(root, keepDir) {
  const complete = cachedSkillDirs(root);
  const keep = new Set([keepDir, ...complete.filter((c) => c.dir !== keepDir).slice(0, SKILL_VERSIONS_KEPT - 1).map((c) => c.dir)]);
  try {
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      if (!keep.has(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`[skills] prune ${root} failed:`, e.message);
  }
}
async function downloadSkill(name, root) {
  const manifest = await (await skillHttp(`/api/skills/${name}/manifest`)).json();
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!SKILL_HASH_RE.test(manifest?.manifest_hash || "") || skillManifestHash(files) !== manifest.manifest_hash) throw new Error("manifest does not match its hash");
  const finalDir = path.join(root, manifest.manifest_hash);
  if (fs.existsSync(path.join(finalDir, ".ok"))) return { dir: finalDir, version: manifest.version };
  const previous = cachedSkillDirs(root);
  const tmpBase = path.join(SKILLS_DIR, ".tmp");
  fs.mkdirSync(tmpBase, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(tmpBase, `${name}-`));
  try {
    for (const f of files) {
      const dest = skillFilePath(tmp, f.path);
      if (!dest || !SKILL_HASH_RE.test(f.sha256 || "") || !Number.isInteger(f.size) || f.size < 0) throw new Error(`invalid manifest entry ${String(f.path).slice(0, 80)}`);
      let data = null;
      for (const p of previous) {
        const old = skillFilePath(p.dir, f.path);
        try {
          const buf = fs.readFileSync(old);
          if (crypto.createHash("sha256").update(buf).digest("hex") === f.sha256) { data = buf; break; }
        } catch {}
      }
      if (!data) {
        const res = await skillHttp(`/api/skill-blobs/${f.sha256}`);
        data = Buffer.from(await res.arrayBuffer());
      }
      if (data.length !== f.size || crypto.createHash("sha256").update(data).digest("hex") !== f.sha256) throw new Error(`${f.path}: content does not match its hash`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data, { mode: f.mode === 493 ? 493 : 420 });
    }
    if (!fs.existsSync(path.join(tmp, "SKILL.md"))) throw new Error("SKILL.md missing from the manifest");
    fs.writeFileSync(path.join(tmp, ".ok"), JSON.stringify({ version: manifest.version, at: Date.now() }));
    try {
      fs.renameSync(tmp, finalDir);
    } catch (e) {
      // Another agent process on this machine finished the same revision first.
      if (!fs.existsSync(path.join(finalDir, ".ok"))) throw e;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  pruneSkillDir(root, finalDir);
  return { dir: finalDir, version: manifest.version };
}
// ref: { name, version, manifest_hash } from the trigger. → { name, version, dir, body, stale?, error? }
// A cached copy of the exact revision means no network at all. When the server cannot be reached the
// newest cached copy is used (stale); a skill the server says is gone is never run from the cache.
async function ensureSkill(ref) {
  const name = ref?.name;
  if (!SKILL_NAME_RE.test(name || "")) return { name: String(name), error: "invalid skill name" };
  const prev = skillLocks.get(name) || Promise.resolve();
  const run = prev.then(() => ensureSkillUnlocked(name, ref));
  const tail = run.catch(() => {});
  skillLocks.set(name, tail);
  tail.then(() => { if (skillLocks.get(name) === tail) skillLocks.delete(name); });
  return run;
}
async function ensureSkillUnlocked(name, ref) {
  const root = path.join(SKILLS_DIR, name);
  const read = (dir, version, extra = {}) => ({ name, version, dir, body: fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"), ...extra });
  if (SKILL_HASH_RE.test(ref.manifest_hash || "")) {
    const exact = path.join(root, ref.manifest_hash);
    if (fs.existsSync(path.join(exact, ".ok"))) {
      try {
        return read(exact, ref.version);
      } catch (e) {
        console.error(`[skills] ${name}: cached copy unreadable, downloading again:`, e.message);
        fs.rmSync(exact, { recursive: true, force: true });
      }
    }
  }
  try {
    fs.mkdirSync(root, { recursive: true });
    const got = await downloadSkill(name, root);
    return read(got.dir, got.version);
  } catch (e) {
    console.error(`[skills] ${name}: download failed:`, e.message);
    const cached = e.gone ? null : cachedSkillDirs(root)[0];
    if (cached) {
      try {
        return read(cached.dir, cached.version, { stale: e.message });
      } catch {}
    }
    return { name, version: ref.version, error: e.message };
  }
}
function skillPreamble(results) {
  const blocks = results.map((r) => {
    if (r.error) return `<stoa-skill name="${r.name}" error="download failed">
Skill /${r.name} could not be loaded: ${r.error}. Tell the user it is unavailable instead of guessing its steps.
</stoa-skill>`;
    const note = r.stale ? `
(The Stoa server could not be reached — ${r.stale}. This is the cached copy, version ${r.version ?? "?"}; it may be out of date.)` : "";
    return `<stoa-skill name="${r.name}" version="${r.version ?? "?"}" dir="${r.dir}">
${r.body}
</stoa-skill>${note}`;
  });
  if (results.some((r) => !r.error)) blocks.push("Supporting files of each skill are in its `dir` (read-only: do not write output there — write output to the room workdir).");
  return blocks.join("\n");
}
async function prependSkills(prompt, refs) {
  if (!Array.isArray(refs) || !refs.length) return prompt;
  const results = await Promise.all(refs.slice(0, 3).map((r) => ensureSkill(r)));
  return `${skillPreamble(results)}

${prompt}`;
}
var SCAN_EXCLUDE_SYSTEM = /* @__PURE__ */ new Set([
  // Windows C:\ level
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "system volume information",
  "$recycle.bin",
  "recovery",
  "users",
  "boot",
  "efi",
  "msocache",
  // Windows USERPROFILE level (default folders)
  "downloads",
  "documents",
  "music",
  "pictures",
  "videos",
  "desktop",
  "appdata",
  "onedrive",
  "contacts",
  "favorites",
  "links",
  "saved games",
  "searches",
  "3d objects",
  // Unix/common
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__"
]);
function scanForWorkdirs() {
  const home = os.homedir();
  const isWindows = process.platform === "win32";
  const results = [];
  function hasClaudeMarker(dir) {
    try {
      const entries = fs.readdirSync(dir);
      return entries.includes(".claude") || entries.includes("CLAUDE.md");
    } catch {
      return false;
    }
  }
  function parseJsonc(filePath) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
  function scanDir(dir, depth, maxDepth, excludeSet) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (dir !== home && path.basename(dir) !== ".claude" && hasClaudeMarker(dir)) {
        results.push({ path: dir, is_default: dir === home + "/stoa-workspace" || dir === path.join(home, "stoa-workspace") });
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
        if (excludeSet.has(entry.name.toLowerCase())) continue;
        if (path.basename(dir) === ".claude" && entry.name === "projects") continue;
        scanDir(path.join(dir, entry.name), depth + 1, maxDepth, excludeSet);
      }
    } catch {
    }
  }
  const homeExclude = /* @__PURE__ */ new Set([...SCAN_EXCLUDE_SYSTEM]);
  scanDir(home, 0, 3, homeExclude);
  if (isWindows) {
    const cDrive = "C:\\";
    const cExclude = /* @__PURE__ */ new Set([...SCAN_EXCLUDE_SYSTEM, "users"]);
    try {
      const topDirs = fs.readdirSync(cDrive, { withFileTypes: true });
      for (const entry of topDirs) {
        if (!entry.isDirectory()) continue;
        if (cExclude.has(entry.name.toLowerCase())) continue;
        scanDir(path.join(cDrive, entry.name), 0, 2, SCAN_EXCLUDE_SYSTEM);
      }
    } catch {
    }
  }
  const defaultWorkDir = process.env.STOA_WORK_DIR;
  if (defaultWorkDir && fs.existsSync(defaultWorkDir)) {
    const normalized = path.resolve(defaultWorkDir);
    if (!results.find((r) => path.resolve(r.path) === normalized)) {
      results.unshift({ path: normalized, is_default: true });
    } else {
      const existing = results.find((r) => path.resolve(r.path) === normalized);
      if (existing) existing.is_default = true;
    }
  }
  for (const r of results) knownWorkdirs.add(path.resolve(r.path));
  return { workdirs: results };
}
function handleHumanMessage(msg) {
  if (msg.type === "history") {
    if (msg.messages.length) {
      out(C.gray + `\u2500\u2500 ${msg.messages.length} pesan sebelumnya \u2500\u2500` + C.reset);
      msg.messages.forEach(renderMessage);
      out(C.gray + "\u2500\u2500 sekarang \u2500\u2500" + C.reset);
    }
    return;
  }
  if (msg.type === "message_new") {
    renderMessage(msg.message);
    reprompt();
    return;
  }
  if (msg.type === "message_state" && msg.state === "streaming") {
    const color = colorFromHex(msg.avatar_color);
    out("");
    process.stdout.write(color + C.bold + msg.avatar_symbol + " " + msg.actor_name + C.reset + "  " + C.gray + "\u25CF\u25CF\u25CF" + C.reset);
    activeStreams[msg.message_id] = { actor_name: msg.actor_name, color, symbol: msg.avatar_symbol, started: false };
    return;
  }
  if (msg.type === "message_token") {
    const s = activeStreams[msg.message_id];
    if (!s) return;
    if (!s.started) {
      process.stdout.write("\r\x1B[K" + s.color + C.bold + s.symbol + " " + s.actor_name + C.reset + "  ");
      s.started = true;
    }
    process.stdout.write(msg.token);
    return;
  }
  if (msg.type === "message_complete") {
    if (activeStreams[msg.message_id]) {
      out("");
      delete activeStreams[msg.message_id];
      reprompt();
    }
    return;
  }
  if (msg.type === "invite_suggestion") {
    const a = msg.suggested_actor;
    out(C.yellow + `\u250C\u2500 Invite suggestion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u2502  ${a.avatar_symbol} ${a.name} diusulkan masuk room ini
\u2502  Alasan: ${msg.reason || "\u2014"}
\u2502  /approve ${msg.invite_id}  atau  /reject ${msg.invite_id}
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500` + C.reset);
    reprompt();
  }
}
function renderMessage(m) {
  const color = colorFromHex(m.avatar_color);
  const ts = m.created_at ? new Date(m.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
  out("\n" + color + C.bold + m.avatar_symbol + " " + m.actor_name + C.reset + C.gray + "  " + ts + C.reset);
  out(m.content);
}
function startPrompt() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  reprompt();
  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      reprompt();
      return;
    }
    if (input === "/exit") {
      ws.close();
      rl.close();
      return;
    }
    const m = input.match(/^\/(approve|reject) (\d+)$/);
    if (m) {
      const approved = m[1] === "approve";
      const inviteUrl = `${STOA_URL.replace("ws://", "http://")}/api/invites/${m[2]}/resolve`;
      await fetch(inviteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stoaCfHeaders(inviteUrl) },
        body: JSON.stringify({ approved })
      });
      out(C.gray + `[Invite ${approved ? "approved" : "rejected"}]` + C.reset);
      reprompt();
      return;
    }
    send({ type: "send_message", room_id: ROOM_ID, content: input });
    reprompt();
  });
}
function reprompt() {
  if (rl) rl.setPrompt(C.white + "\u25C9  " + C.reset);
  rl?.prompt(true);
}
function printHeader() {
  out(C.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n  STOA  \u2014  Room #" + ROOM_ID + "\n  /exit untuk keluar\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + C.reset);
}
var _sendOverride = null;
var _getSessionOverride = null;
var _prepareResumeOverride = null;
var _fetchOverride = null;
// agent_complete / agent_error are the only record of a run's result, so they never go straight
// to the socket: they wait here until the server has acknowledged the handshake (agent_ready) and
// leave only once ws.send reports the frame written. One sent while the socket is down is replayed
// after the next reconnect; the server ignores a replay it already applied. Stream tokens and
// progress are not worth replaying and are still dropped while disconnected.
var OUTBOX_TYPES = /* @__PURE__ */ new Set(["agent_complete", "agent_error"]);
var OUTBOX_MAX = 50;
var outbox = [];
var outboxReady = false;
function send(data) {
  if (_sendOverride) return _sendOverride(data);
  if (OUTBOX_TYPES.has(data?.type)) {
    if (outbox.length >= OUTBOX_MAX) {
      const dropped = outbox.shift();
      console.warn(`[stoa] outbox full (${OUTBOX_MAX}) \u2014 dropped ${dropped.data.type} for msg=${dropped.data.message_id}`);
    }
    outbox.push({ data, sending: false });
    return flushOutbox();
  }
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function flushOutbox() {
  if (!outboxReady || ws?.readyState !== WebSocket.OPEN) return;
  for (const entry of outbox) {
    if (entry.sending) continue;
    entry.sending = true;
    ws.send(JSON.stringify(entry.data), (err) => {
      if (err) { entry.sending = false; return; }
      const i = outbox.indexOf(entry);
      if (i !== -1) outbox.splice(i, 1);
    });
  }
}
function setOutboxReady(ready) {
  outboxReady = ready;
  // A frame still unconfirmed when the socket drops may never have left: replay it on the next one.
  if (!ready) for (const entry of outbox) entry.sending = false;
  else flushOutbox();
}
// Runs whose result has not reached the server yet: still running, queued, or waiting in the outbox.
function activeMessageIds() {
  return [...new Set([...activeTriggers.keys(), ...triggerQueue.map((t) => t.message_id), ...outbox.map((e) => e.data.message_id)])];
}
function out(line) {
  process.stdout.write("\n" + line + "\n");
}
if (require.main === module) {
process.on("SIGINT", () => {
  clearTimeout(reconnectTimer);
  for (const s of sessionPool.values()) s.shutdown();
  ws?.close();
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  console.error("[stoa] uncaughtException:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("[stoa] unhandledRejection:", err?.message || err);
});
var keepAlive = setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.ping?.();
  } else if (ACTOR_TYPE === "ai" && ws?.readyState === WebSocket.CLOSED) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    connect();
  }
}, 2e4);
if (CF_ACCESS) {
  cfProxyReady = startCfForwardProxy({ getUpstream: () => STOA_URL, creds: CF_ACCESS, log: (m) => console.error(m) })
    .then((p) => { console.log(`[stoa] Cloudflare Access token active; child sessions use loopback proxy on port ${p.port}`); return p; })
    .catch((e) => { console.error(`[stoa] Cloudflare Access proxy failed to start: ${e.message}`); return null; });
}
if (ACTOR_TYPE === "ai") {
  preConnectUpdate().then(() => {
    connect();
    updateChecker = setInterval(checkForUpdates, UPDATE_INTERVAL);
    setInterval(() => sweepStaleTriggers(Date.now()), STALE_SWEEP_INTERVAL_MS);
  });
} else {
  connect();
}
}
function __setDeps(overrides) {
  if (overrides.send) _sendOverride = overrides.send;
  if (overrides.ws) ws = overrides.ws;
  if (overrides.FETCH_TIMEOUT_MS != null) FETCH_TIMEOUT_MS = overrides.FETCH_TIMEOUT_MS;
  if (overrides.getSession) _getSessionOverride = overrides.getSession;
  if (overrides.prepareResume) _prepareResumeOverride = overrides.prepareResume;
  if (overrides.fetch) _fetchOverride = overrides.fetch;
  if (overrides.SESSION_IDLE_TTL != null) SESSION_IDLE_TTL = overrides.SESSION_IDLE_TTL;
  if (overrides.BACKGROUND_HOLD_MAX_MS != null) BACKGROUND_HOLD_MAX_MS = overrides.BACKGROUND_HOLD_MAX_MS;
  if (overrides.doRestart) _restartOverride = overrides.doRestart;
  if (overrides.skillsDir) SKILLS_DIR = overrides.skillsDir;
}
function __resetDeps() {
  _sendOverride = null;
  _getSessionOverride = null;
  _prepareResumeOverride = null;
  _fetchOverride = null;
  SKILLS_DIR = DEFAULT_SKILLS_DIR;
  skillLocks.clear();
  SESSION_IDLE_TTL = 5;
  BACKGROUND_HOLD_MAX_MS = 3 * 60 * 60 * 1e3;
  FETCH_TIMEOUT_MS = 60000;
  consecutiveTriggerErrors = 0;
  _restartOverride = null;
  pendingRestart = false;
  pendingRestartSince = 0;
  ws = null;
  outbox.length = 0;
  outboxReady = false;
}
module.exports = { handleAgentMessage, fetchToFile, fetchText, drainQueue, runTrigger, activeTriggers, triggerQueue, pendingSteerMessages, MAX_CONCURRENT, processTrigger, sweepStaleTriggers, STALE_TRIGGER_MS, RESTART_STALL_MS, TOOL_STALL_MS, forceRestartIfStalled, checkForUpdates, preConnectUpdate, FIRST_TOKEN_TIMEOUT, attachHeartbeatWatchdog, HEARTBEAT_MIN_SILENCE_MS, __setDeps, __resetDeps, extractAndUploadFiles, attachUnsolicitedHandler, postUnsolicitedResult, startSessionIdleTimer, clearSessionIdleTimer, sessionPool, MAX_UPLOAD_BYTES, send, outbox, OUTBOX_MAX, activeMessageIds, ensureSkill, prependSkills, skillManifestHash };
