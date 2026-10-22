'use strict';
// MCP presets offered in the "Add" tab. A preset fixes transport + command / url; the owner only
// supplies the env fields. Versions are pinned so an install does not silently pick up a new upstream release.
// Postgres is not offered: its reference server is deprecated on npm with no maintained official successor.

const PRESETS = [
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date library and framework documentation for coding agents.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@2.0.0'],
    docs_url: 'https://github.com/upstash/context7',
    env_fields: [],
  },
  // Playground: no account or key, for trying the gateway out. Everything is the protocol's own test
  // server (echo, sums, sample images, long-running calls).
  {
    id: 'everything',
    name: 'Everything (test server)',
    description: 'Official MCP test server: echo, add numbers, sample images and long-running calls. No account needed.',
    transport: 'stdio',
    auth: 'none',
    playground: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything@2026.8.31'],
    docs_url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    env_fields: [],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'A small knowledge graph (entities, relations, notes) agents can write and search. Shared by every agent with access; kept in the npx cache on the Stoa server. No account needed.',
    transport: 'stdio',
    auth: 'none',
    playground: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory@2026.8.31'],
    docs_url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    env_fields: [],
  },
  {
    id: 'thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step thinking tool that lets an agent revise and branch its reasoning. No account needed.',
    transport: 'stdio',
    auth: 'none',
    playground: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking@2026.8.31'],
    docs_url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    env_fields: [],
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    description: 'Ask questions about and read generated docs of public GitHub repositories (remote server). No account needed.',
    transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: 'none',
    playground: true,
    docs_url: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    env_fields: [],
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: 'Web, news, image and local search through the Brave Search API (official Brave server). Needs a Brave Search API key.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server@2.1.4'],
    docs_url: 'https://github.com/brave/brave-search-mcp-server',
    env_fields: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search API key', secret: true, required: true, help: 'From api-dashboard.search.brave.com (the free plan is enough to try it).' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, code search and repository content (official remote GitHub MCP server).',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'headers',
    // Field values are stored encrypted; the request header is built from this template at connect time.
    headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
    docs_url: 'https://github.com/github/github-mcp-server',
    env_fields: [
      { key: 'GITHUB_PAT', label: 'Personal access token', secret: true, required: true, help: 'Fine-grained token with only the repositories and permissions the agents need.' },
    ],
  },
  // OAuth presets: no fields; the owner connects the server from the MCP page (dynamic client
  // registration + PKCE against the provider's own authorization server).
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read and update pages and databases in a Notion workspace (official remote server).',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    docs_url: 'https://developers.notion.com/docs/mcp',
    env_fields: [],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects and comments in a Linear workspace (official remote server).',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    docs_url: 'https://linear.app/docs/mcp',
    env_fields: [],
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
  return PRESETS.map(({ id, name, description, transport, auth, playground, docs_url, env_fields }) => ({
    id, name, description, transport, auth, playground: !!playground, docs_url, env_fields: env_fields.map(f => ({ ...f })),
  }));
}

module.exports = { PRESETS, getPreset, publicCatalog, connectionEnv };
