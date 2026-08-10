// ──────────────────────────────────────────────────────────────
// Implements the MCP SDK's `OAuthClientProvider` interface, backed by:
//  - Postgres for durable state (DCR client registration, per-user
//    access/refresh tokens) — see migrations/add_mcp_integration.sql
//  - express-session for the short-lived PKCE code_verifier + state
//    that only need to survive the redirect-out-and-back-in round trip
//
// One provider instance is created per request (see services/mcp/client.js)
// and is only ever used for a single MCP server + single user at a time,
// matching the SDK's "one provider per session" contract.
// ──────────────────────────────────────────────────────────────

const crypto = require('crypto');
const pool = require('../../db');

// ── Client registration (DCR) — shared across all users, per server ──

async function loadClientInformation(serverKey) {
  const result = await pool.query(
    `SELECT client_id, client_secret, client_id_issued_at, client_secret_expires_at
     FROM mcp_client_registrations WHERE server_key = $1`,
    [serverKey]
  );
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    client_id: row.client_id,
    client_secret: row.client_secret || undefined,
    client_id_issued_at: row.client_id_issued_at
      ? Math.floor(new Date(row.client_id_issued_at).getTime() / 1000)
      : undefined,
    client_secret_expires_at: row.client_secret_expires_at
      ? Math.floor(new Date(row.client_secret_expires_at).getTime() / 1000)
      : undefined,
  };
}

async function saveClientInformationRow(serverKey, info) {
  await pool.query(
    `INSERT INTO mcp_client_registrations
       (server_key, client_id, client_secret, client_id_issued_at, client_secret_expires_at, raw_metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (server_key) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       client_secret = EXCLUDED.client_secret,
       client_id_issued_at = EXCLUDED.client_id_issued_at,
       client_secret_expires_at = EXCLUDED.client_secret_expires_at,
       raw_metadata = EXCLUDED.raw_metadata,
       updated_at = CURRENT_TIMESTAMP`,
    [
      serverKey,
      info.client_id,
      info.client_secret || null,
      info.client_id_issued_at ? new Date(info.client_id_issued_at * 1000) : null,
      info.client_secret_expires_at ? new Date(info.client_secret_expires_at * 1000) : null,
      JSON.stringify(info),
    ]
  );
}

// ── Tokens — per (user, server) ──

async function loadTokensRow(serverKey, userId) {
  const result = await pool.query(
    `SELECT access_token, refresh_token, token_type, scope, expires_at
     FROM user_mcp_connections WHERE user_id = $1 AND server_key = $2`,
    [userId, serverKey]
  );
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  const expiresIn = row.expires_at
    ? Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000))
    : undefined;
  return {
    access_token: row.access_token,
    token_type: row.token_type || 'Bearer',
    refresh_token: row.refresh_token || undefined,
    scope: row.scope || undefined,
    expires_in: expiresIn,
  };
}

async function saveTokensRow(serverKey, userId, tokens) {
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;
  await pool.query(
    `INSERT INTO user_mcp_connections
       (user_id, server_key, access_token, refresh_token, token_type, scope, expires_at, connected_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, server_key) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       -- Many OAuth servers omit refresh_token on a refresh response
       -- (meaning "keep using the one you have") rather than rotating it.
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_mcp_connections.refresh_token),
       token_type = EXCLUDED.token_type,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
    [
      userId,
      serverKey,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.token_type || 'Bearer',
      tokens.scope || null,
      expiresAt,
    ]
  );
}

async function deleteTokensRow(serverKey, userId) {
  await pool.query(
    'DELETE FROM user_mcp_connections WHERE user_id = $1 AND server_key = $2',
    [userId, serverKey]
  );
}

/**
 * Builds an MCP SDK `OAuthClientProvider` for one (server, user) pair.
 *
 * @param {object} opts
 * @param {string} opts.serverKey
 * @param {string} opts.serverUrl
 * @param {string} opts.redirectUrl - our /api/mcp/:serverKey/callback URL
 * @param {number} opts.userId
 * @param {import('express-session').Session} opts.session - req.session,
 *   used to stash the PKCE verifier + state across the redirect round trip
 */
function createOAuthProvider({ serverKey, serverUrl, redirectUrl, userId, session }) {
  session.mcpOauth = session.mcpOauth || {};
  session.mcpOauth[serverKey] = session.mcpOauth[serverKey] || {};
  const flowState = session.mcpOauth[serverKey];

  return {
    pendingAuthorizationUrl: undefined,

    get redirectUrl() {
      return redirectUrl;
    },

    get clientMetadata() {
      return {
        client_name: 'SanjayAIHub',
        client_uri: redirectUrl ? new URL(redirectUrl).origin : undefined,
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },

    state() {
      const value = crypto.randomBytes(16).toString('hex');
      flowState.state = value;
      return value;
    },

    async clientInformation() {
      return loadClientInformation(serverKey);
    },

    async saveClientInformation(info) {
      await saveClientInformationRow(serverKey, info);
    },

    async tokens() {
      return loadTokensRow(serverKey, userId);
    },

    async saveTokens(tokens) {
      await saveTokensRow(serverKey, userId, tokens);
    },

    redirectToAuthorization(authorizationUrl) {
      // Server-side: we don't actually redirect from inside the provider
      // (no `res` here) — the route handler catches UnauthorizedError and
      // reads this back to issue the real HTTP redirect.
      this.pendingAuthorizationUrl = authorizationUrl.toString();
    },

    saveCodeVerifier(codeVerifier) {
      flowState.codeVerifier = codeVerifier;
    },

    codeVerifier() {
      if (!flowState.codeVerifier) {
        throw new Error('No PKCE code verifier found for this session — please restart the connect flow.');
      }
      return flowState.codeVerifier;
    },

    async invalidateCredentials(scope) {
      if (scope === 'tokens' || scope === 'all') {
        await deleteTokensRow(serverKey, userId);
      }
      if (scope === 'verifier' || scope === 'all') {
        delete flowState.codeVerifier;
        delete flowState.state;
      }
      // Deliberately NOT clearing 'client' registration here even on
      // scope 'all' — that row is shared across every user of this app,
      // so one user's bad token shouldn't force everyone to re-register.
    },
  };
}

module.exports = { createOAuthProvider };
