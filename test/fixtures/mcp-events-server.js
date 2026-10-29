#!/usr/bin/env node
'use strict';
// Minimal stdio MCP server for the MCP events tests in test.js (no network). One tool:
//   events_env {} → {url, token} from STOA_EVENTS_URL / STOA_EVENTS_TOKEN (null when not set)
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'events-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'events_env', description: 'Stoa events env', inputSchema: { type: 'object', properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ url: process.env.STOA_EVENTS_URL ?? null, token: process.env.STOA_EVENTS_TOKEN ?? null }) }],
}));
server.connect(new StdioServerTransport());
