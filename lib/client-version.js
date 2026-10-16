'use strict';

const CLIENT_VERSION_RE = /^(?:const|var)\s+CLIENT_VERSION\s*=\s*['"]([^'"]+)['"]/m;

function parseClientVersion(src) {
  const m = src.match(CLIENT_VERSION_RE);
  return m ? m[1] : null;
}

module.exports = { parseClientVersion, CLIENT_VERSION_RE };
