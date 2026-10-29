-- Keep-alive MCP servers (stdio only): never idle-stopped or LRU-evicted, started at boot and restarted
-- with backoff after an exit, so an event source (POST /api/mcp/events) keeps running without tool calls.
ALTER TABLE mcp_servers ADD COLUMN keep_alive INTEGER NOT NULL DEFAULT 0 CHECK(keep_alive IN (0,1));
