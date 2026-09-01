// Phase 6 — Proactive Triggers: pure scheduling helpers.
//
// Kept dependency-free and side-effect-free so they can be unit-tested
// deterministically (pass `from` in, get the next run out — no Date.now()
// inside). server.js is the only caller; the scheduler loop lives there.
//
// Two schedule shapes (Opsi A — deliberately NOT full cron, to keep the
// validation/parse surface small):
//   { type: 'interval', every_minutes: N }        // N in [5, 1440]
//   { type: 'daily', at: 'HH:MM', tz: 'Area/City' } // 24h wall-clock in tz

'use strict';

const MIN_INTERVAL_MINUTES = 5;      // floor: prevents every_minutes:1 budget drain
const MAX_INTERVAL_MINUTES = 1440;   // ceiling: 24h (use `daily` for longer)

// A timezone is valid iff Intl accepts it. Throws RangeError for garbage.
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Validate + normalize an untrusted schedule spec (from API body / DB).
// Returns { ok: true, spec } with a fresh whitelisted object, or
// { ok: false, error } with a short reason. Never mutates the input.
function validateScheduleSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, error: 'spec must be an object' };
  }
  if (spec.type === 'interval') {
    for (const k of Object.keys(spec)) {
      if (k !== 'type' && k !== 'every_minutes') return { ok: false, error: `unknown field: ${k}` };
    }
    const n = spec.every_minutes;
    if (!Number.isInteger(n) || n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) {
      return { ok: false, error: `every_minutes must be an integer ${MIN_INTERVAL_MINUTES}..${MAX_INTERVAL_MINUTES}` };
    }
    return { ok: true, spec: { type: 'interval', every_minutes: n } };
  }
  if (spec.type === 'daily') {
    for (const k of Object.keys(spec)) {
      if (k !== 'type' && k !== 'at' && k !== 'tz') return { ok: false, error: `unknown field: ${k}` };
    }
    if (typeof spec.at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.at)) {
      return { ok: false, error: 'at must be HH:MM (24-hour)' };
    }
    const tz = spec.tz == null ? 'UTC' : spec.tz;
    if (!isValidTimeZone(tz)) return { ok: false, error: 'unknown tz' };
    return { ok: true, spec: { type: 'daily', at: spec.at, tz } };
  }
  return { ok: false, error: "type must be 'interval' or 'daily'" };
}

// Wall-clock → UTC helpers for `daily`, no tz library. WIB (Asia/Jakarta) has
// no DST so this is exact for the primary use case; for DST zones the two-pass
// resolution below lands on the correct instant except within the ~1h/year
// spring-forward gap, where it snaps to the nearest valid instant (acceptable
// for a daily report).

// Offset (ms) such that: wallClockAsIfUTC(instant, tz) - instant === offset.
function tzOffsetMs(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  let hour = +p.hour;
  if (hour === 24) hour = 0; // some engines emit '24' for midnight
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

// The UTC instant at which the wall clock in `tz` reads y-mo-d h:mi:00.
function zonedWallToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let off = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off;
  off = tzOffsetMs(new Date(utc), tz); // second pass corrects DST-boundary guesses
  utc = guess - off;
  return utc;
}

// Next UTC instant strictly after `from` at which the tz wall clock reads `at`.
function nextDailyOccurrence(at, tz, from) {
  const [h, mi] = at.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(from);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const y = +p.year, mo = +p.month, d = +p.day;
  let candidate = zonedWallToUtc(y, mo, d, h, mi, tz);
  if (candidate <= from.getTime()) {
    const next = new Date(Date.UTC(y, mo - 1, d) + 86400000); // roll one calendar day
    candidate = zonedWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), h, mi, tz);
  }
  return new Date(candidate);
}

// Next run as a Date, strictly after `from` (Date or epoch-ms). Pure.
// For `interval` this is skip-missed by construction: callers recompute from
// `now`, so a long downtime yields one future slot, never a catch-up burst.
function computeNextRun(spec, from) {
  const fromMs = from instanceof Date ? from.getTime() : from;
  if (spec.type === 'interval') {
    return new Date(fromMs + spec.every_minutes * 60000);
  }
  if (spec.type === 'daily') {
    return nextDailyOccurrence(spec.at, spec.tz || 'UTC', new Date(fromMs));
  }
  throw new Error('invalid spec');
}

module.exports = {
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  isValidTimeZone,
  validateScheduleSpec,
  computeNextRun,
};
