// R29: Display verbosity — per-room settings with global fallback
// Resolved: room-level override → global default → built-in default

const _DISPLAY_BUILT_IN = { tool_progress: 'all', live_status: 'full', cleanup_progress: 'off' };

let _displayGlobal = { ..._DISPLAY_BUILT_IN };
let _displayRoom   = {};  // only keys with room-level overrides

function _resolve(key) {
  return _displayRoom[key] ?? _displayGlobal[key] ?? _DISPLAY_BUILT_IN[key];
}

function getToolProgress()    { return _resolve('tool_progress'); }
function getLiveStatus()      { return _resolve('live_status'); }
function getCleanupProgress() { return _resolve('cleanup_progress'); }

// Called on 'display_settings' WS event (sent when room is subscribed)
function applyDisplaySettings(room, global) {
  if (global) _displayGlobal = { ..._DISPLAY_BUILT_IN, ...global };
  _displayRoom = room ? { ...room } : {};
}

// Called on 'room_setting' / 'room_setting_ack' for display keys
function applyRoomDisplaySetting(key, value) {
  if (!['tool_progress', 'live_status', 'cleanup_progress'].includes(key)) return;
  if (value == null) {
    delete _displayRoom[key];
  } else {
    _displayRoom[key] = value;
  }
}

// Reset when leaving a room
function clearRoomDisplay() {
  _displayRoom = {};
}
