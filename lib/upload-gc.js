// Upload orphan GC (R18). Server-only: never required by the agent client bundle.
// Split audit (read-only verdict) from reclaim (mutation) for dry-run-ability.
const fs = require('fs');
const path = require('path');

// An agent uploads a file (/api/upload/raw) BEFORE the message that references it is written
// (attachments land when its turn completes), so a fresh unreferenced file is not an orphan yet.
const UPLOAD_GC_GRACE_MS = 24 * 3600_000;

function auditUploads(db, uploadsDir, { now = Date.now(), graceMs = UPLOAD_GC_GRACE_MS } = {}) {
  const referenced = new Set();
  for (const row of db.prepare('SELECT image_url FROM messages WHERE image_url IS NOT NULL').all())
    referenced.add(row.image_url);
  for (const row of db.prepare('SELECT file_url FROM messages WHERE file_url IS NOT NULL').all())
    referenced.add(row.file_url);
  for (const row of db.prepare('SELECT json_each.value FROM messages, json_each(messages.attachments) WHERE messages.attachments IS NOT NULL').all())
    try { const a = JSON.parse(row.value); if (a?.url) referenced.add(a.url); } catch {}
  for (const row of db.prepare('SELECT avatar_url FROM actors WHERE avatar_url IS NOT NULL').all())
    referenced.add(row.avatar_url);
  for (const row of db.prepare('SELECT avatar_url FROM sub_agents WHERE avatar_url IS NOT NULL').all())
    referenced.add(row.avatar_url);

  const orphans = [];
  try {
    for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const rel = `/uploads/${entry.name}`;
      if (referenced.has(rel)) continue;
      const fp = path.join(uploadsDir, entry.name);
      let mtimeMs;
      try { mtimeMs = fs.statSync(fp).mtimeMs; } catch { continue; }
      if (now - mtimeMs < graceMs) continue;
      orphans.push({ path: fp, url: rel });
    }
  } catch (e) { console.error('[gc] auditUploads scan error:', e.message); }
  return orphans;
}

function reclaimUploads(orphans) {
  let count = 0;
  for (const { path: fp } of orphans) {
    try { fs.unlinkSync(fp); count++; } catch (e) { console.error('[gc] delete error:', fp, e.message); }
  }
  return count;
}

module.exports = { auditUploads, reclaimUploads, UPLOAD_GC_GRACE_MS };
