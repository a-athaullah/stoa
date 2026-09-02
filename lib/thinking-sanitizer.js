'use strict';

const THINKING_TYPES = new Set(['thinking', 'redacted_thinking']);

const THINKING_MARKER_RE = /^\s*(?:\[thinking\]\s*)+/;

function stripLeadingThinkingMarker(text) {
  return typeof text === 'string' ? text.replace(THINKING_MARKER_RE, '') : text;
}

function isThinkingSignatureError(text = '') {
  if (!text || text.length > 600) return false;
  const lower = text.toLowerCase();
  return lower.includes('thinking')
    && (lower.includes('signature') || lower.includes('cannot be modified') || lower.includes('must remain as they were'));
}

function matchThinkingBlock(b, { stripAll = false } = {}) {
  if (!b || typeof b !== 'object') return false;
  if (THINKING_TYPES.has(b.type)) {
    if (stripAll) return true;
    if (b.type === 'thinking' && !b.signature) return true;
    if (b.type === 'redacted_thinking' && !b.data) return true;
    if (b.cache_control) return true;
    return false;
  }
  if (b.type === 'text' && typeof b.text === 'string' && THINKING_MARKER_RE.test(b.text)) return true;
  return false;
}

function replaceThinkingBlock(b, { stripAll = false } = {}) {
  if (THINKING_TYPES.has(b.type)) {
    if (stripAll) return null;
    if (b.cache_control) {
      const { cache_control, ...rest } = b;
      return rest;
    }
    return null;
  }
  const cleaned = stripLeadingThinkingMarker(b.text);
  return cleaned ? { ...b, text: cleaned } : null;
}

module.exports = {
  THINKING_TYPES,
  THINKING_MARKER_RE,
  stripLeadingThinkingMarker,
  isThinkingSignatureError,
  matchThinkingBlock,
  replaceThinkingBlock,
};
