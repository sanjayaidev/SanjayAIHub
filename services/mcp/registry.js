// ──────────────────────────────────────────────────────────────
// Registry of MCP (Model Context Protocol) servers this app knows how to
// connect users to. Add more entries here later — the OAuth plumbing in
// services/mcp/oauth-provider.js and services/mcp/client.js, and the
// routes in routes/mcp.js, are all generic and keyed off `server_key`.
// ──────────────────────────────────────────────────────────────

const SERVERS = {
  higgsfield: {
    key: 'higgsfield',
    name: 'Higgsfield',
    url: 'https://mcp.higgsfield.ai/mcp',
    description: 'AI image and video generation (30+ models).',
  },
};

function getServerConfig(serverKey) {
  return SERVERS[serverKey] || null;
}

function listServers() {
  return Object.values(SERVERS);
}

module.exports = { SERVERS, getServerConfig, listServers };
