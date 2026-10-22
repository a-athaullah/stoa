#!/usr/bin/env node
'use strict';
// Minimal stdio MCP server for test.js (no network). Tools:
//   echo {text}        → text back, whether env DUMMY_SECRET reached the upstream ("set"/"unset"), and
//                         whether the Stoa server's own env leaked in (DB_PATH / STOA_TEST_* are set
//                         on the test server by run-tests.js)
//   send_note {note}   → "sent" (name looks like a write tool)
//   big {bytes}        → a text result of the given size
//   fail {}            → isError result
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const tools = [
  { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'send_note', description: 'Pretend to send a note', inputSchema: { type: 'object', properties: { note: { type: 'string' } } } },
  { name: 'big', description: 'Large result', inputSchema: { type: 'object', properties: { bytes: { type: 'number' } } } },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

const server = new Server({ name: 'dummy', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = req.params.arguments || {};
  switch (req.params.name) {
    case 'echo': return text(JSON.stringify({ text: a.text ?? '', secret: process.env.DUMMY_SECRET ? 'set' : 'unset', leak: process.env.DB_PATH || process.env.STOA_TEST || process.env.STOA_TEST_PASSWORD ? 'leaked' : 'clean' }));
    case 'send_note': return text('sent');
    case 'big': return text('x'.repeat(Math.min(Number(a.bytes) || 0, 2_000_000)));
    case 'fail': return text('dummy failure', true);
    default: return text(`unknown tool ${req.params.name}`, true);
  }
});
server.connect(new StdioServerTransport());
