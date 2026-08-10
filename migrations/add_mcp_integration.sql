-- MCP (Model Context Protocol) integration.
-- Generic tables — server_key identifies which MCP server (currently just
-- 'higgsfield', more can be added later without schema changes).

-- One row per MCP server this app has Dynamically-Client-Registered with.
-- Shared across all users — this is *our app's* client identity with the
-- server's OAuth authorization server, not a per-user credential.
CREATE TABLE IF NOT EXISTS mcp_client_registrations (
  server_key VARCHAR(64) PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  client_id_issued_at TIMESTAMPTZ,
  client_secret_expires_at TIMESTAMPTZ,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user OAuth connection/tokens for a given MCP server (e.g. a user's
-- own Higgsfield account, linked via "Connect Higgsfield").
CREATE TABLE IF NOT EXISTS user_mcp_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_key VARCHAR(64) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type VARCHAR(32) NOT NULL DEFAULT 'Bearer',
  scope TEXT,
  expires_at TIMESTAMPTZ,
  resource TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, server_key)
);
CREATE INDEX IF NOT EXISTS idx_user_mcp_connections_user ON user_mcp_connections(user_id);

-- History of tool calls made through a connected MCP server, so the
-- Higgsfield module page can show "My generations" without re-querying
-- the remote server every time.
CREATE TABLE IF NOT EXISTS mcp_generations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_key VARCHAR(64) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  input_args JSONB,
  output_text TEXT,
  output_urls JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'complete', -- 'complete' | 'error'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_generations_user ON mcp_generations(user_id, created_at DESC);
