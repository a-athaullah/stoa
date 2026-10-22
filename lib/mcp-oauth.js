'use strict';
// OAuth for remote MCP servers (mcp_servers.auth = 'oauth'). The SDK's auth() does the protocol work
// (RFC 9728 / 8414 discovery, dynamic client registration, PKCE S256, refresh); this module is its
// OAuthClientProvider: it keeps the client registration and tokens encrypted in mcp_servers.oauth_enc
// and holds the one-time state between POST …/oauth/start and the provider's redirect back to
// GET /api/mcp/oauth/callback. Nothing stored here is ever returned by the API.

const crypto = require('crypto');

const CALLBACK_PATH = '/api/mcp/oauth/callback';
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING_STATES = 50;

class OAuthFlowError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createMcpOAuth({ db, encrypt, decrypt, log = console, now = Date.now, sdk = null }) {
  const S = sdk || { auth: require('@modelcontextprotocol/sdk/client/auth.js').auth };
  const q = {
    row: db.prepare('SELECT * FROM mcp_servers WHERE id=?'),
    save: db.prepare('UPDATE mcp_servers SET oauth_enc=? WHERE id=?'),
  };
  const pending = new Map();         // state → { serverId, redirectUri, codeVerifier, expiresAt }

  // → { redirect_uri, client, tokens } (any may be missing). Unreadable → {} so the server shows needs_auth.
  function load(row) {
    if (!row?.oauth_enc) return {};
    try {
      const v = JSON.parse(decrypt(row.oauth_enc));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { log.error(`[mcp:${row.slug}] stored oauth state unreadable: ${e.message}`); return {}; }
  }

  // Read-modify-write against the current row: the SDK saves client info and tokens in separate calls.
  function store(serverId, patch) {
    const next = { ...load(q.row.get(serverId)), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    q.save.run(Object.keys(next).length ? encrypt(JSON.stringify(next)) : null, serverId);
  }

  const needsAuth = (row) => row?.auth === 'oauth' && !load(row).tokens?.access_token;

  // A client registration is bound to the redirect URI it was registered with; connecting from another
  // origin registers again. ignoreTokens: start() always asks the owner, even if a refresh would work.
  function provider(serverId, { redirectUri = null, state = null, codeVerifier = null, onRedirect = null, ignoreTokens = false } = {}) {
    const redirect = redirectUri || load(q.row.get(serverId)).redirect_uri;
    let verifier = codeVerifier;
    return {
      get redirectUrl() { return redirect; },
      get clientMetadata() {
        return {
          client_name: 'Stoa', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'], token_endpoint_auth_method: 'none',
        };
      },
      ...(state ? { state: () => state } : {}),
      clientInformation: () => {
        const s = load(q.row.get(serverId));
        return s.redirect_uri === redirect ? s.client : undefined;
      },
      saveClientInformation: (client) => store(serverId, { client, redirect_uri: redirect }),
      tokens: () => (ignoreTokens ? undefined : load(q.row.get(serverId)).tokens),
      saveTokens: (tokens) => store(serverId, { tokens }),
      // Headless (upstream connection): nobody to redirect, so the transport reports UnauthorizedError
      // and the server shows needs_auth until the owner connects again.
      redirectToAuthorization: (url) => { onRedirect?.(url); },
      saveCodeVerifier: (v) => { verifier = v; },
      codeVerifier: () => {
        if (!verifier) throw new Error('no PKCE verifier for this authorization');
        return verifier;
      },
      invalidateCredentials: (scope) => {
        if (scope === 'all') store(serverId, { client: undefined, tokens: undefined });
        else if (scope === 'client') store(serverId, { client: undefined });
        else if (scope === 'tokens') store(serverId, { tokens: undefined });
      },
    };
  }

  function sweep() {
    const t = now();
    for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
    while (pending.size >= MAX_PENDING_STATES) pending.delete(pending.keys().next().value);
  }

  // origin: the owner's already-validated browser origin. → authorize URL for the owner to open.
  async function start(row, origin) {
    if (row.transport !== 'http' || row.auth !== 'oauth') throw new OAuthFlowError(400, 'this MCP server does not use OAuth');
    sweep();
    const redirectUri = new URL(CALLBACK_PATH, origin).href;
    const state = crypto.randomBytes(24).toString('base64url');
    let authorizeUrl = null;
    const p = provider(row.id, { redirectUri, state, ignoreTokens: true, onRedirect: (u) => { authorizeUrl = u; } });
    let result;
    try { result = await S.auth(p, { serverUrl: row.url }); }
    catch (e) { throw new OAuthFlowError(502, `OAuth discovery or registration failed: ${String(e.message || e).slice(0, 300)}`); }
    if (result !== 'REDIRECT' || !authorizeUrl) throw new OAuthFlowError(502, 'the authorization server did not start an authorization');
    // The owner's browser opens this; a javascript: or data: URL from a hostile server must not get there.
    if (authorizeUrl.protocol !== 'https:' && authorizeUrl.protocol !== 'http:') throw new OAuthFlowError(502, 'authorization endpoint must be http(s)');
    pending.set(state, { serverId: row.id, redirectUri, codeVerifier: p.codeVerifier(), expiresAt: now() + STATE_TTL_MS });
    return authorizeUrl.href;
  }

  // The state is consumed on first use, whatever happens next. → server id the tokens were saved for.
  async function finish({ state, code, error }) {
    const entry = typeof state === 'string' ? pending.get(state) : undefined;
    if (entry) pending.delete(state);
    if (!entry || entry.expiresAt <= now()) throw new OAuthFlowError(400, 'unknown, used or expired OAuth state');
    const row = q.row.get(entry.serverId);
    if (!row || row.auth !== 'oauth') throw new OAuthFlowError(404, 'MCP server not found');
    const fail = (msg) => Object.assign(new OAuthFlowError(400, msg), { serverId: row.id });
    if (error) throw fail(`authorization was not granted (${String(error).slice(0, 100)})`);
    if (typeof code !== 'string' || !code || code.length > 4096) throw fail('missing authorization code');
    const p = provider(row.id, { redirectUri: entry.redirectUri, codeVerifier: entry.codeVerifier });
    try { await S.auth(p, { serverUrl: row.url, authorizationCode: code }); }
    catch (e) { throw fail(`token exchange failed: ${String(e.message || e).slice(0, 300)}`); }
    return row.id;
  }

  function clear(serverId) { q.save.run(null, serverId); }

  return { provider, needsAuth, start, finish, clear };
}

module.exports = { createMcpOAuth, OAuthFlowError, CALLBACK_PATH, STATE_TTL_MS };
