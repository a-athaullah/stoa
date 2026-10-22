'use strict';
// MCP presets offered in the "Add" tab. A preset fixes transport + command / url; the owner only
// supplies the env fields. Versions are pinned so an install does not silently pick up a new upstream release.
// Postgres is not offered: its reference server is deprecated on npm with no maintained official successor.
// Fetch and Git are not offered: their reference servers are Python (uvx), which the Stoa server does not have.
// Stdio upstreams run on the Stoa server for every agent with access, wherever the agent itself runs.

const fs = require('fs');
const path = require('path');
const { presetIcon } = require('./mcp-icons');

const MAX_PATHS = 16;
// The install holds .credentials-key and the DB: a Filesystem server with access to it would hand every
// stored secret to the agents.
const STOA_ROOT = path.resolve(__dirname, '..');

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
  // Browsers: headless (no window on the owner's screen) and isolated (a throwaway profile, never the
  // owner's Chrome cookies or logins). File tools stay inside the server's own work dir (lib/mcp-upstreams.js).
  {
    id: 'chrome',
    name: 'Chrome DevTools',
    description: 'Drive a headless Chrome: open pages, click and type, read console and network, record performance traces (official Google server). Runs on the Stoa server, so localhost means the Stoa machine. No account needed.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    // --no-usage-statistics / --no-performance-crux: no telemetry, and visited URLs are not sent to the CrUX API.
    args: ['-y', 'chrome-devtools-mcp@1.12.0', '--headless', '--isolated', '--no-usage-statistics', '--no-performance-crux'],
    docs_url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    env_fields: [],
    // Hands a local file of the Stoa server to the page.
    tool_defaults: { upload_file: { requires_approval: true } },
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation through accessibility snapshots: navigate, click, fill forms, screenshots (official Microsoft server). Runs headless on the Stoa server. No account needed.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.83', '--headless', '--isolated'],
    docs_url: 'https://github.com/microsoft/playwright-mcp',
    env_fields: [],
    tool_defaults: {
      // Upstream documents it as RCE-equivalent: arbitrary JavaScript in the server process on the Stoa machine.
      browser_run_code_unsafe: { enabled: false },
      browser_file_upload: { requires_approval: true },
    },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, search and edit files in folders you choose on the Stoa server (official MCP server). Agents on other machines reach these folders too. Writes ask for approval by default.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@2.0.0'],
    docs_url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    env_fields: [
      { key: 'ALLOWED_DIRS', label: 'Allowed folders', secret: false, required: true, kind: 'paths',
        help: 'Absolute folders on the Stoa server, separated by commas. Not /, and not the Stoa install folder or a folder around or inside it (it holds the credentials key).' },
    ],
    tool_defaults: {
      write_file: { requires_approval: true },
      edit_file: { requires_approval: true },
      create_directory: { requires_approval: true },
      move_file: { requires_approval: true },
    },
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
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'The Cloudflare API (DNS, Workers, R2, zones and more) for the accounts you grant (official remote server).',
    transport: 'http',
    url: 'https://mcp.cloudflare.com/mcp',
    auth: 'oauth',
    docs_url: 'https://github.com/cloudflare/mcp',
    env_fields: [],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Projects, database (SQL), edge functions and logs of a Supabase organization (official remote server, beta).',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    auth: 'oauth',
    docs_url: 'https://supabase.com/docs/guides/getting-started/mcp',
    env_fields: [],
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Tasks, projects, sections and comments in Todoist (official remote server by Doist).',
    transport: 'http',
    url: 'https://ai.todoist.net/mcp',
    auth: 'oauth',
    docs_url: 'https://github.com/Doist/todoist-ai',
    env_fields: [],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Issues, events, releases and projects in Sentry (official server). Seer (paid AI analysis) is turned off.',
    transport: 'stdio',
    auth: 'none',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server@0.42.0', '--disable-skills=seer'],
    docs_url: 'https://github.com/getsentry/sentry-mcp',
    env_fields: [
      { key: 'SENTRY_ACCESS_TOKEN', label: 'User auth token', secret: true, required: true, help: 'Sentry → Settings → Personal Tokens, with org:read, project:read and event:read (add event:write to let agents update issues).' },
      { key: 'SENTRY_HOST', label: 'Host (self-hosted only)', secret: false, required: false, help: 'Leave empty for sentry.io.' },
    ],
  },
];

// Comma-separated absolute folders → { dirs } or { error }. Each must be an existing directory (symlinks
// resolved) that is not the filesystem root and neither holds nor sits inside a protected folder.
function parsePaths(value, { protectedDirs = [STOA_ROOT], realpath = fs.realpathSync, stat = fs.statSync } = {}) {
  const parts = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'at least one folder is required' };
  if (parts.length > MAX_PATHS) return { error: `at most ${MAX_PATHS} folders` };
  const guarded = protectedDirs.map(d => { try { return realpath(d); } catch { return path.resolve(d); } });
  const dirs = [];
  for (const p of parts) {
    if (!path.isAbsolute(p)) return { error: `${p} is not an absolute path` };
    let real;
    try { real = realpath(p); } catch { return { error: `${p} does not exist` }; }
    try { if (!stat(real).isDirectory()) return { error: `${p} is not a folder` }; } catch { return { error: `${p} does not exist` }; }
    if (path.parse(real).root === real) return { error: `${p} is the filesystem root` };
    const within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);
    if (guarded.some(g => within(real, g) || within(g, real))) return { error: `${p} overlaps the Stoa install` };
    if (!dirs.includes(real)) dirs.push(real);
  }
  return { dirs };
}

// Preset-specific checks on top of env_fields required/unknown → error string or null.
function validatePresetValues(preset, values, opts = {}) {
  for (const f of preset.env_fields) {
    if (f.kind === 'paths' && values[f.key]) {
      const { error } = parsePaths(values[f.key], opts);
      if (error) return `${f.label}: ${error}`;
    }
  }
  return null;
}

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || null;
}

// Stored values → what the transport gets: env vars (stdio) or request headers (http). A preset with a
// header template maps its fields into headers; a header whose field is empty is left out.
function connectionEnv(row, values) {
  const preset = row?.preset ? getPreset(row.preset) : null;
  if (!preset?.headers) {
    // 'paths' fields go to argv (connectionArgs), not into the upstream's environment.
    const argKeys = new Set((preset?.env_fields || []).filter(f => f.kind === 'paths').map(f => f.key));
    return argKeys.size ? Object.fromEntries(Object.entries(values).filter(([k]) => !argKeys.has(k))) : values;
  }
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

// Fields of kind 'paths' become trailing args (the filesystem server takes its folders as argv), re-resolved
// at start so a folder that became a symlink to somewhere protected is refused then, not only at save time.
function connectionArgs(row, values, opts = {}) {
  const preset = row?.preset ? getPreset(row.preset) : null;
  const out = [];
  for (const f of preset?.env_fields || []) {
    if (f.kind !== 'paths') continue;
    const { dirs, error } = parsePaths(values[f.key], opts);
    if (error) throw new Error(`${f.label}: ${error}`);
    out.push(...dirs);
  }
  return out;
}

// Override rows a fresh install of the preset starts with (the owner can change them on the MCP page).
function presetToolDefaults(preset) {
  return Object.entries(preset?.tool_defaults || {}).map(([tool, d]) => ({
    tool, enabled: d.enabled === false ? 0 : 1, requires_approval: d.requires_approval ? 1 : 0,
  }));
}

// The catalog API never exposes the command line; the server takes it from the preset at install time.
function publicCatalog() {
  return PRESETS.map(({ id, name, description, transport, auth, playground, docs_url, env_fields }) => ({
    id, name, description, transport, auth, playground: !!playground, docs_url, env_fields: env_fields.map(f => ({ ...f })),
    icon: presetIcon(id),
  }));
}

module.exports = { PRESETS, getPreset, publicCatalog, connectionEnv, connectionArgs, validatePresetValues, presetToolDefaults, parsePaths };
