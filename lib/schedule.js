// Scheduled triggers: pure scheduling helpers.
//
// Kept dependency-free and side-effect-free so they can be unit-tested
// deterministically (pass `from` in, get the next run out — no Date.now()
// inside). server.js is the only caller; the scheduler loop lives there.
//
// Five schedule shapes (deliberately NOT full cron, to keep the
// validation/parse surface small). Wall-clock types take `at` (24h 'HH:MM')
// in `tz` (IANA name, default 'UTC'):
//   { type: 'interval', every_minutes: N }                 // N in [5, 1440]
//   { type: 'daily',   at, tz }
//   { type: 'weekly',  at, tz, days: [0..6] }               // 0 = Sunday
//   { type: 'monthly', at, tz, day: 1..31 }                 // clamps to the month's last day
//   { type: 'yearly',  at, tz, month: 1..12, day: 1..31 }   // Feb 29 → Feb 28 in non-leap years

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

const AT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WALL_FIELDS = {
  daily: ['at', 'tz'],
  weekly: ['at', 'tz', 'days'],
  monthly: ['at', 'tz', 'day'],
  yearly: ['at', 'tz', 'month', 'day'],
};
const TYPES_MSG = "type must be one of 'interval', 'daily', 'weekly', 'monthly', 'yearly'";

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
// Longest a month can be in any year: Feb counts 29 so a Feb 29 birthday is accepted.
const maxDaysInMonth = (mo) => daysInMonth(2000, mo);

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
  const fields = Object.prototype.hasOwnProperty.call(WALL_FIELDS, spec.type) ? WALL_FIELDS[spec.type] : null;
  if (!fields) return { ok: false, error: TYPES_MSG };
  for (const k of Object.keys(spec)) {
    if (k !== 'type' && !fields.includes(k)) return { ok: false, error: `unknown field: ${k}` };
  }
  if (typeof spec.at !== 'string' || !AT_RE.test(spec.at)) {
    return { ok: false, error: 'at must be HH:MM (24-hour)' };
  }
  const tz = spec.tz == null ? 'UTC' : spec.tz;
  if (!isValidTimeZone(tz)) return { ok: false, error: 'unknown tz' };
  const out = { type: spec.type, at: spec.at, tz };

  if (spec.type === 'weekly') {
    const days = spec.days;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) {
      return { ok: false, error: 'days must be a non-empty array of weekdays 0..6 (0 = Sunday)' };
    }
    if (!days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { ok: false, error: 'days must be integers 0..6 (0 = Sunday)' };
    }
    if (new Set(days).size !== days.length) return { ok: false, error: 'days must not repeat' };
    out.days = [...days].sort((a, b) => a - b);
  } else if (spec.type === 'monthly') {
    if (!Number.isInteger(spec.day) || spec.day < 1 || spec.day > 31) {
      return { ok: false, error: 'day must be an integer 1..31' };
    }
    out.day = spec.day;
  } else if (spec.type === 'yearly') {
    if (!Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) {
      return { ok: false, error: 'month must be an integer 1..12' };
    }
    if (!Number.isInteger(spec.day) || spec.day < 1 || spec.day > maxDaysInMonth(spec.month)) {
      return { ok: false, error: `day must be an integer 1..${maxDaysInMonth(spec.month)} for month ${spec.month}` };
    }
    out.month = spec.month;
    out.day = spec.day;
  }
  return { ok: true, spec: out };
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

// Calendar date (y, mo, d) that the wall clock in `tz` shows at `instant`.
function zonedDate(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day };
}

// Calendar arithmetic on plain dates via UTC (never touches the tz offset).
function addDays({ y, mo, d }, n) {
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Every wall-clock type walks forward over candidate calendar dates (in tz),
// starting at the tz date of `from`, and returns the first slot strictly after
// `from`. Loops are bounded: the first matching date is at most 7 days (weekly),
// 2 months (monthly) or 2 years (yearly) away, plus one step of slack for the
// "slot today already passed" case.
function nextWallOccurrence(spec, fromMs) {
  const tz = spec.tz || 'UTC';
  const [h, mi] = spec.at.split(':').map(Number);
  const start = zonedDate(new Date(fromMs), tz);
  const slot = ({ y, mo, d }) => zonedWallToUtc(y, mo, d, h, mi, tz);

  if (spec.type === 'daily' || spec.type === 'weekly') {
    const days = spec.type === 'weekly' ? new Set(spec.days) : null;
    for (let i = 0; i <= 8; i++) {
      const date = addDays(start, i);
      if (days && !days.has(new Date(Date.UTC(date.y, date.mo - 1, date.d)).getUTCDay())) continue;
      const t = slot(date);
      if (t > fromMs) return new Date(t);
    }
  } else if (spec.type === 'monthly') {
    for (let k = 0; k <= 2; k++) {
      const y = start.y + Math.floor((start.mo - 1 + k) / 12);
      const mo = ((start.mo - 1 + k) % 12) + 1;
      const t = slot({ y, mo, d: Math.min(spec.day, daysInMonth(y, mo)) });
      if (t > fromMs) return new Date(t);
    }
  } else if (spec.type === 'yearly') {
    for (let k = 0; k <= 2; k++) {
      const y = start.y + k;
      const d = spec.month === 2 && spec.day === 29 && !isLeapYear(y) ? 28 : spec.day;
      const t = slot({ y, mo: spec.month, d });
      if (t > fromMs) return new Date(t);
    }
  }
  throw new Error('invalid spec');
}

// Next run as a Date, strictly after `from` (Date or epoch-ms). Pure.
// Skip-missed by construction: callers recompute from `now`, so a long
// downtime yields one future slot, never a catch-up burst.
function computeNextRun(spec, from) {
  const fromMs = from instanceof Date ? from.getTime() : from;
  if (spec.type === 'interval') {
    return new Date(fromMs + spec.every_minutes * 60000);
  }
  if (WALL_FIELDS[spec.type]) return nextWallOccurrence(spec, fromMs);
  throw new Error('invalid spec');
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Short English cadence label for a normalized spec, e.g. "weekly Mon, Fri 09:00 Asia/Jakarta".
// Used as the feed badge name of a scheduled run and in system notices.
function describeSchedule(spec) {
  if (!spec || typeof spec !== 'object') return 'schedule';
  if (spec.type === 'interval') return `every ${spec.every_minutes} min`;
  const at = `${spec.at} ${spec.tz || 'UTC'}`;
  if (spec.type === 'daily') return `daily ${at}`;
  if (spec.type === 'weekly') {
    const days = Array.isArray(spec.days) ? spec.days : [];
    return days.length === 7 ? `weekly every day ${at}` : `weekly ${days.map(d => WEEKDAY_SHORT[d]).join(', ')} ${at}`;
  }
  if (spec.type === 'monthly') return `monthly day ${spec.day} ${at}`;
  if (spec.type === 'yearly') return `yearly ${MONTH_SHORT[spec.month - 1]} ${spec.day} ${at}`;
  return 'schedule';
}

// Skip statuses that are TRANSIENT — the condition may clear within the current
// period, and (crucially) fireSchedule returns them BEFORE dispatching, so
// nothing ran. For these we retry soon instead of waiting for the far next slot,
// so e.g. a `daily` schedule isn't lost for the whole day just because the
// target agent's machine was offline at that minute, or the agent was busy with
// the owner's own turn. All other non-fired statuses (room gone / archived /
// target not a participant) are left at the natural next slot.
const TRANSIENT_SKIP = new Set(['agent_offline', 'agent_busy', 'thread_limit']);

// Decide next_run_at after a NON-fired tick, given the already-claimed far slot.
// Pure. `nextSlot` is computeNextRun(spec, now) — the claim written before fire.
// On a transient skip we retry at now+retryMs, but never later than nextSlot
// (so the grace retry can't overshoot the natural next occurrence). On any other
// status we keep nextSlot. Safe because transient skips provably did not dispatch
// — moving next_run_at earlier cannot cause a double-fire.
function nextRunAfterSkip(status, nextSlot, now, retryMs) {
  const slotMs = nextSlot instanceof Date ? nextSlot.getTime() : nextSlot;
  if (TRANSIENT_SKIP.has(status)) {
    const nowMs = now instanceof Date ? now.getTime() : now;
    return new Date(Math.min(nowMs + retryMs, slotMs));
  }
  return new Date(slotMs);
}

const OVERDUE_MS = 15 * 60 * 1000;

// Doctor verdict for one schedule row ({ enabled, next_run_at, last_error } plus
// is_participant = target is still an AI participant of the room). Pure.
// Precedence: not_participant > overdue > error > ok.
function diagnoseSchedule(row, nowMs) {
  if (!row.is_participant) {
    return { status: 'not_participant', details: 'target agent is no longer an AI participant of this room — schedule will not fire' };
  }
  if (row.enabled && row.next_run_at && (nowMs - new Date(row.next_run_at.replace(' ', 'T') + 'Z').getTime()) > OVERDUE_MS) {
    return { status: 'overdue', details: `next_run_at was ${row.next_run_at} UTC — overdue by more than 15 minutes` };
  }
  if (row.last_error) return { status: 'error', details: row.last_error };
  return { status: 'ok', details: null };
}

module.exports = {
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  isValidTimeZone,
  validateScheduleSpec,
  computeNextRun,
  describeSchedule,
  diagnoseSchedule,
  TRANSIENT_SKIP,
  nextRunAfterSkip,
};
