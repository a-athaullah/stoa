'use strict';

const { safeRegexTest } = require('./regex-safety');

function evaluateConditions(conditions, fieldValues) {
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { matched: false, failedIndex: i };
    const val = (fieldValues[c.field] || '').toLowerCase();
    const target = (c.value || '').toLowerCase();
    let ok;
    switch (c.op) {
      case 'contains':      ok = val.includes(target); break;
      case 'not_contains':  ok = !val.includes(target); break;
      case 'starts_with':   ok = val.startsWith(target); break;
      case 'matches_regex': ok = safeRegexTest(c.value, (fieldValues[c.field] || '').slice(0, 5000)); break;
      default: ok = true;
    }
    if (!ok) return { matched: false, failedIndex: i };
  }
  return { matched: true, failedIndex: -1 };
}

module.exports = { evaluateConditions };
