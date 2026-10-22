'use strict';
// MCP presets offered in the "Add" tab. A preset fixes transport + command; the owner only supplies
// the env fields. Versions are pinned so an install does not silently pick up a new upstream release.

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
    description: 'Issues, pull requests, code search and repository content (official GitHub MCP server, runs in Docker).',
    transport: 'stdio',
    command: 'docker',
    args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:v2.0.3'],
    docs_url: 'https://github.com/github/github-mcp-server',
    env_fields: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, required: true, help: 'Fine-grained token with only the repositories and permissions the agents need.' },
    ],
  },
];

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || null;
}

// The catalog API never exposes the command line; the server takes it from the preset at install time.
function publicCatalog() {
  return PRESETS.map(({ id, name, description, transport, docs_url, env_fields }) => ({
    id, name, description, transport, docs_url, env_fields: env_fields.map(f => ({ ...f })),
  }));
}

module.exports = { PRESETS, getPreset, publicCatalog };
