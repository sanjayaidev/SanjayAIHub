// ──────────────────────────────────────────────────────────────
// Thin wrapper around @modelcontextprotocol/sdk's Client +
// StreamableHTTPClientTransport, using our Postgres/session-backed
// OAuthClientProvider (see oauth-provider.js) for auth.
//
// The transport handles token refresh transparently: it tries the stored
// access token, and if the server responds 401, it uses the provider's
// refresh_token to get a new one and retries — no manual expiry-tracking
// needed on our side.
// ──────────────────────────────────────────────────────────────

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const { createOAuthProvider } = require('./oauth-provider');

const CLIENT_INFO = { name: 'sanjayaihub', version: '1.0.0' };

function buildTransport(server, provider) {
  return new StreamableHTTPClientTransport(new URL(server.url), { authProvider: provider });
}

/**
 * Attempts to connect to an MCP server using whatever tokens the user
 * already has (refreshing if needed). If the user isn't connected yet (or
 * their refresh token is dead), returns { authorizationUrl } instead of a
 * client so the caller can redirect the browser there.
 */
async function connectOrGetAuthUrl({ server, userId, session, redirectUrl }) {
  const provider = createOAuthProvider({
    serverKey: server.key,
    serverUrl: server.url,
    redirectUrl,
    userId,
    session,
  });
  const transport = buildTransport(server, provider);
  const client = new Client(CLIENT_INFO);

  try {
    await client.connect(transport);
    return { client, transport };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { authorizationUrl: provider.pendingAuthorizationUrl };
    }
    throw error;
  }
}

/**
 * Completes the OAuth redirect: exchanges the `code` GitHub/Higgsfield/etc.
 * sent back for tokens, via the same provider + transport machinery.
 */
async function finishAuthorization({ server, userId, session, redirectUrl, code }) {
  const provider = createOAuthProvider({
    serverKey: server.key,
    serverUrl: server.url,
    redirectUrl,
    userId,
    session,
  });
  const transport = buildTransport(server, provider);
  await transport.finishAuth(code);
}

/**
 * Runs `fn(client)` against a connected MCP client for this user/server,
 * then always closes the connection. Throws UnauthorizedError (re-exported
 * below) if the user isn't connected / their session couldn't be
 * refreshed — callers should catch this and prompt reconnect.
 */
async function withClient({ server, userId, session, redirectUrl }, fn) {
  const provider = createOAuthProvider({
    serverKey: server.key,
    serverUrl: server.url,
    redirectUrl,
    userId,
    session,
  });
  const transport = buildTransport(server, provider);
  const client = new Client(CLIENT_INFO);

  await client.connect(transport); // throws UnauthorizedError if not connected
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = {
  connectOrGetAuthUrl,
  finishAuthorization,
  withClient,
  UnauthorizedError,
};
