'use strict';
// MCP presets offered in the "Add" tab. A preset fixes transport + command / url; the owner only
// supplies the env fields. Versions are pinned so an install does not silently pick up a new upstream release.

const PRESETS = [
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date library and framework documentation for coding agents.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@2.0.0'],
    docs_url: 'https://github.com/upstash/context7',
    env_fields: [],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, code search and repository content (official remote GitHub MCP server).',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    // Field values are stored encrypted; the request header is built from this template at connect time.
    headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
    docs_url: 'https://github.com/github/github-mcp-server',
    env_fields: [
      { key: 'GITHUB_PAT', label: 'Personal access token', secret: true, required: true, help: 'Fine-grained token with only the repositories and permissions the agents need.' },
    ],
  },
];

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || null;
}

// Stored values → what the transport gets: env vars (stdio) or request headers (http). A preset with a
// header template maps its fields into headers; a header whose field is empty is left out.
function connectionEnv(row, values) {
  const preset = row?.preset ? getPreset(row.preset) : null;
  if (!preset?.headers) return values;
  const out = {};
  for (const [name, template] of Object.entries(preset.headers)) {
    let missing = false;
    const value = template.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => {
      if (typeof values[k] !== 'string' || !values[k]) missing = true;
      return values[k] || '';
    });
    if (!missing) out[name] = value;
  }
  return out;
}

// The catalog API never exposes the command line; the server takes it from the preset at install time.
function publicCatalog() {
  return PRESETS.map(({ id, name, description, transport, docs_url, env_fields }) => ({
    id, name, description, transport, docs_url, env_fields: env_fields.map(f => ({ ...f })),
  }));
}

module.exports = { PRESETS, getPreset, publicCatalog, connectionEnv };
