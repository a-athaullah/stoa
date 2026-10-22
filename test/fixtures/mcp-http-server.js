'use strict';
// Remote (streamable HTTP) MCP server for the gateway tests, run inside the test process.
// mode 'bearer': /mcp needs `Authorization: Bearer <bearer>`.
// mode 'oauth':  /mcp needs an access token from this server's own OAuth 2.1 authorization server
//                (RFC 9728 resource metadata, RFC 8414 metadata, dynamic client registration, PKCE S256).
// The browser step is simulated by authorize(url): it checks the request the gateway built and
// returns the code + state the provider would redirect back with.

const http = require('http');
const crypto = require('crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function startMcpHttpFixture({ mode = 'bearer', bearer = null } = {}) {
  const clients = new Map();       // client_id → registration
  const codes = new Map();         // code → { challenge, redirect_uri, client_id }
  const accessTokens = new Set();
  const refreshTokens = new Set();
  const stats = { registrations: 0, tokenRequests: 0, refreshes: 0, mcpRequests: 0 };
  let base = '';

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => resolve(d));
  });

  function authorized(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return false;
    return mode === 'oauth' ? accessTokens.has(m[1]) : m[1] === bearer;
  }

  async function handleMcp(req, res) {
    stats.mcpRequests++;
    if (!authorized(req)) {
      const www = mode === 'oauth' ? `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` : 'Bearer';
      return send(res, 401, { error: 'invalid_token' }, { 'WWW-Authenticate': www });
    }
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || 'null') : undefined;
    const server = new Server({ name: 'fixture-http', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'whoami', description: 'Says which auth mode let the call in', inputSchema: { type: 'object', properties: {} } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: `hello via ${mode}` }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handleToken(req, res) {
    stats.tokenRequests++;
    const p = new URLSearchParams(await readBody(req));
    const issue = () => {
      const access = 'at_' + b64url(crypto.randomBytes(16));
      const refresh = 'rt_' + b64url(crypto.randomBytes(16));
      accessTokens.add(access); refreshTokens.add(refresh);
      return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh };
    };
    if (p.get('grant_type') === 'authorization_code') {
      const c = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (!c || c.client_id !== p.get('client_id') || c.redirect_uri !== p.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
      const challenge = b64url(crypto.createHash('sha256').update(String(p.get('code_verifier') || '')).digest());
      if (challenge !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
      return send(res, 200, issue());
    }
    if (p.get('grant_type') === 'refresh_token' && refreshTokens.has(p.get('refresh_token'))) {
      stats.refreshes++;
      refreshTokens.delete(p.get('refresh_token'));
      return send(res, 200, issue());
    }
    return send(res, 400, { error: 'invalid_grant' });
  }

  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      const p = url.pathname;
      if (p === '/mcp') return await handleMcp(req, res);
      if (mode !== 'oauth') return send(res, 404, { error: 'not found' });
      if (p === '/.well-known/oauth-protected-resource/mcp' || p === '/.well-known/oauth-protected-resource') {
        return send(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] });
      }
      if (p === '/.well-known/oauth-authorization-server') {
        return send(res, 200, {
          issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
          response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (p === '/register' && req.method === 'POST') {
        stats.registrations++;
        const meta = JSON.parse((await readBody(req)) || '{}');
        const reg = { ...meta, client_id: 'client_' + stats.registrations, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none' };
        clients.set(reg.client_id, reg);
        return send(res, 201, reg);
      }
      if (p === '/token' && req.method === 'POST') return await handleToken(req, res);
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e.message });
    }
  });

  // The owner's browser at the authorization endpoint: validate the request, mint a one-time code.
  function authorize(authorizeUrl) {
    const u = new URL(authorizeUrl);
    if (u.origin + u.pathname !== `${base}/authorize`) throw new Error(`unexpected authorize endpoint ${u.origin}${u.pathname}`);
    const q = Object.fromEntries(u.searchParams);
    const reg = clients.get(q.client_id);
    if (!reg) throw new Error('unknown client_id');
    if (!reg.redirect_uris?.includes(q.redirect_uri)) throw new Error('redirect_uri not registered');
    if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) throw new Error('not a PKCE code request');
    const code = 'code_' + b64url(crypto.randomBytes(12));
    codes.set(code, { challenge: q.code_challenge, redirect_uri: q.redirect_uri, client_id: q.client_id });
    return { code, state: q.state, redirect_uri: q.redirect_uri, resource: q.resource };
  }

  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${srv.address().port}`;
      resolve({
        base, mcpUrl: `${base}/mcp`, stats, authorize,
        revokeAll: () => { accessTokens.clear(); refreshTokens.clear(); },
        close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()); }),
      });
    });
  });
}

module.exports = { startMcpHttpFixture };
