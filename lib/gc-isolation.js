'use strict';
// A throwaway server (screenshots, ad-hoc debugging) runs with its own DB_PATH. Every GC that deletes
// "files the DB no longer references" would then compare the live install's files with an unrelated DB
// and wipe them (uploads 2026-10-26, skill blobs 2026-11-19). This lists the file dirs such a server
// still shares with the live install, so server.js skips the GC passes over them.
const path = require('path');

// name → [env var, default path relative to the repo root]
const FILE_DIRS = {
  uploads: ['STOA_UPLOADS_DIR', 'uploads'],
  'connector-media': ['STOA_CONNECTOR_MEDIA_DIR', 'connector-media'],
  'skill-blobs': ['STOA_SKILL_BLOBS_DIR', path.join('data', 'skill-blobs')],
};

// → names of FILE_DIRS left at the default while DB_PATH points away from the default DB. [] for the
// live install itself (DB_PATH unset or the default file) and for a fully isolated server.
function sharedLiveDirs(env, rootDir) {
  const root = path.resolve(rootDir);
  if (!env.DB_PATH || path.resolve(env.DB_PATH) === path.join(root, 'db', 'stoa.db')) return [];
  return Object.entries(FILE_DIRS)
    .filter(([, [key, rel]]) => !env[key] || path.resolve(env[key]) === path.join(root, rel))
    .map(([name]) => name);
}

module.exports = { sharedLiveDirs, FILE_DIRS };
