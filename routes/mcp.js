const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getServerConfig, listServers } = require('../services/mcp/registry');
const { connectOrGetAuthUrl, finishAuthorization, withClient, UnauthorizedError } = require('../services/mcp/client');
const { getBaseUrl } = require('../services/oauth-accounts');
require('dotenv').config();

const router = express.Router();

function callbackUrlFor(req, serverKey) {
  return `${getBaseUrl(req)}/api/mcp/${serverKey}/callback`;
}

function loadServerOr404(req, res) {
  const server = getServerConfig(req.params.serverKey);
  if (!server) {
    res.status(404).json({ success: false, message: `Unknown MCP server '${req.params.serverKey}'` });
    return null;
  }
  return server;
}

// Postgres error 42P01 = undefined_table. In practice this only ever
// means one thing here: migrations/add_mcp_integration.sql hasn't been
// run against this database yet. Surface that clearly instead of a raw
// stack trace / generic 500, both in the logs and in the API response.
function isMissingTableError(error) {
  return error && error.code === '42P01';
}

function logAndRespondDbError(res, error, context, redirectTo) {
  if (isMissingTableError(error)) {
    console.error(
      `[MCP] ${context}: database tables are missing. Run ` +
      `"psql $DATABASE_URL < migrations/add_mcp_integration.sql" against ` +
      `this environment's database, then try again. (${error.message})`
    );
    const message = 'MCP is not set up on this server yet (missing database tables) — an admin needs to run the pending migration.';
    if (redirectTo) return redirectTo(message);
    return res.status(503).json({ success: false, code: 'MCP_NOT_MIGRATED', message });
  }
  console.error(`[MCP] ${context}:`, error);
  const message = redirectTo ? null : 'Server error';
  if (redirectTo) return redirectTo(message);
  return res.status(500).json({ success: false, message });
}

// ──────────────────────────────────────────────
// GET /api/mcp/servers — list configured MCP servers (for the frontend
// to render "Connect X" cards without hardcoding the list).
// ──────────────────────────────────────────────
router.get('/servers', (req, res) => {
  res.json({ success: true, servers: listServers() });
});

// ──────────────────────────────────────────────
// GET /api/mcp/:serverKey/connect
//
// Reached as a plain top-level browser navigation (a button, not fetch),
// so it can't carry an Authorization header — same constraint as the
// coding-agent's GitHub connect flow. It accepts a one-time `?token=`
// JWT, verifies it, stashes the user id in the session, then continues.
// See server.js's /agent bridge middleware for the original version of
// this pattern.
// ──────────────────────────────────────────────
router.get('/:serverKey/connect', async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  if (req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
      req.session.mcpUserId = decoded.id;
      const cleanUrl = req.originalUrl.replace(/([?&])token=[^&]*&?/, '$1').replace(/[?&]$/, '');
      return req.session.save((err) => {
        if (err) console.error('[MCP] Session save failed:', err);
        res.redirect(cleanUrl);
      });
    } catch (err) {
      return res.redirect(`/higgsfield.html?mcp_error=${encodeURIComponent('Your session expired. Please log in again.')}`);
    }
  }

  const userId = req.session.mcpUserId;
  if (!userId) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Please log in first.')}`);
  }

  try {
    const redirectUrl = callbackUrlFor(req, server.key);
    const result = await connectOrGetAuthUrl({ server, userId, session: req.session, redirectUrl });

    if (result.client) {
      // Already had a valid (or refreshable) connection — nothing to do.
      await result.client.close().catch(() => {});
      return res.redirect(`/higgsfield.html?connected=1`);
    }

    if (result.authorizationUrl) {
      return res.redirect(result.authorizationUrl);
    }

    throw new Error('MCP server did not return an authorization URL');
  } catch (error) {
    return logAndRespondDbError(res, error, `${server.key} connect failed`, (message) =>
      res.redirect(`/higgsfield.html?mcp_error=${encodeURIComponent(message || 'Could not start Higgsfield sign-in. Please try again.')}`)
    );
  }
});

// ──────────────────────────────────────────────
// GET /api/mcp/:serverKey/callback
// Higgsfield (or whichever server) redirects back here with ?code=&state=
// ──────────────────────────────────────────────
router.get('/:serverKey/callback', async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  const { code, state, error: providerError } = req.query;
  const userId = req.session.mcpUserId;

  if (providerError) {
    return res.redirect(`/higgsfield.html?mcp_error=${encodeURIComponent('Sign-in was cancelled.')}`);
  }
  if (!userId) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Your session expired. Please log in and try connecting again.')}`);
  }

  const flowState = req.session.mcpOauth && req.session.mcpOauth[server.key];
  if (!code || !state || !flowState || state !== flowState.state) {
    return res.redirect(`/higgsfield.html?mcp_error=${encodeURIComponent('Invalid or expired sign-in attempt. Please try again.')}`);
  }

  try {
    const redirectUrl = callbackUrlFor(req, server.key);
    await finishAuthorization({ server, userId, session: req.session, redirectUrl, code });
    delete req.session.mcpOauth[server.key];
    return res.redirect(`/higgsfield.html?connected=1`);
  } catch (error) {
    return logAndRespondDbError(res, error, `${server.key} callback failed`, (message) =>
      res.redirect(`/higgsfield.html?mcp_error=${encodeURIComponent(message || 'Higgsfield sign-in failed. Please try again.')}`)
    );
  }
});

// ──────────────────────────────────────────────
// GET /api/mcp/:serverKey/status — is the current (JWT-authenticated) user
// connected to this server?
// ──────────────────────────────────────────────
router.get('/:serverKey/status', authenticateToken, async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  try {
    const result = await pool.query(
      'SELECT connected_at FROM user_mcp_connections WHERE user_id = $1 AND server_key = $2',
      [req.user.id, server.key]
    );
    res.json({
      success: true,
      connected: result.rows.length > 0,
      connectedAt: result.rows[0]?.connected_at || null,
    });
  } catch (error) {
    return logAndRespondDbError(res, error, 'status check failed');
  }
});

// ──────────────────────────────────────────────
// POST /api/mcp/:serverKey/disconnect
// ──────────────────────────────────────────────
router.post('/:serverKey/disconnect', authenticateToken, async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  try {
    await pool.query(
      'DELETE FROM user_mcp_connections WHERE user_id = $1 AND server_key = $2',
      [req.user.id, server.key]
    );
    res.json({ success: true, message: `Disconnected from ${server.name}` });
  } catch (error) {
    return logAndRespondDbError(res, error, 'disconnect failed');
  }
});

// ──────────────────────────────────────────────
// GET /api/mcp/:serverKey/tools — list available tools + their input
// schemas, so the frontend can render a form without us hardcoding tool
// names (Higgsfield's tool catalog can change on their end).
// ──────────────────────────────────────────────
router.get('/:serverKey/tools', authenticateToken, async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  try {
    const redirectUrl = callbackUrlFor(req, server.key);
    const tools = await withClient(
      { server, userId: req.user.id, session: req.session, redirectUrl },
      async (client) => {
        const result = await client.listTools();
        return result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        }));
      }
    );
    res.json({ success: true, tools });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({
        success: false,
        code: 'NOT_CONNECTED',
        message: `Not connected to ${server.name}. Please connect first.`,
      });
    }
    if (isMissingTableError(error)) {
      return logAndRespondDbError(res, error, `${server.key} tools/list failed`);
    }
    console.error(`[MCP] ${server.key} tools/list failed:`, error);
    res.status(502).json({ success: false, message: `Could not reach ${server.name}. Please try again.` });
  }
});

// ──────────────────────────────────────────────
// POST /api/mcp/:serverKey/call — invoke a tool: { tool, arguments }
// ──────────────────────────────────────────────
router.post('/:serverKey/call', authenticateToken, async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  const { tool, arguments: toolArgs } = req.body || {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing "tool" name' });
  }

  try {
    const redirectUrl = callbackUrlFor(req, server.key);
    const callResult = await withClient(
      { server, userId: req.user.id, session: req.session, redirectUrl },
      (client) => client.callTool({ name: tool, arguments: toolArgs || {} })
    );

    const content = Array.isArray(callResult.content) ? callResult.content : [];
    const textParts = content.filter((c) => c.type === 'text').map((c) => c.text);
    const urls = [];
    for (const block of content) {
      if (block.type === 'resource_link' && block.uri) urls.push(block.uri);
      if (block.type === 'resource' && block.resource?.uri) urls.push(block.resource.uri);
      if (block.type === 'image' && block.data && block.mimeType) {
        urls.push(`data:${block.mimeType};base64,${block.data}`);
      }
    }
    // Some tool outputs put URLs directly in the text (e.g. a plain
    // markdown/plaintext link to the generated asset) — pull those out too
    // so the frontend can render a preview without parsing prose itself.
    const urlPattern = /https?:\/\/[^\s)"']+/g;
    for (const text of textParts) {
      const found = text.match(urlPattern);
      if (found) urls.push(...found);
    }

    const isError = !!callResult.isError;
    const outputText = textParts.join('\n\n');

    await pool.query(
      `INSERT INTO mcp_generations (user_id, server_key, tool_name, input_args, output_text, output_urls, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user.id,
        server.key,
        tool,
        JSON.stringify(toolArgs || {}),
        outputText || null,
        JSON.stringify(urls),
        isError ? 'error' : 'complete',
        isError ? outputText : null,
      ]
    );

    res.json({
      success: !isError,
      text: outputText,
      urls,
      raw: callResult,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({
        success: false,
        code: 'NOT_CONNECTED',
        message: `Not connected to ${server.name}. Please connect first.`,
      });
    }
    if (isMissingTableError(error)) {
      return logAndRespondDbError(res, error, `${server.key} tools/call failed`);
    }
    console.error(`[MCP] ${server.key} tools/call failed:`, error);
    res.status(502).json({ success: false, message: error.message || `${server.name} generation failed. Please try again.` });
  }
});

// ──────────────────────────────────────────────
// GET /api/mcp/:serverKey/history — past generations for this user
// (stored locally, doesn't re-hit the MCP server).
// ──────────────────────────────────────────────
router.get('/:serverKey/history', authenticateToken, async (req, res) => {
  const server = loadServerOr404(req, res);
  if (!server) return;

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await pool.query(
      `SELECT id, tool_name, input_args, output_text, output_urls, status, error_message, created_at
       FROM mcp_generations
       WHERE user_id = $1 AND server_key = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [req.user.id, server.key, limit]
    );
    res.json({ success: true, generations: result.rows });
  } catch (error) {
    return logAndRespondDbError(res, error, 'history fetch failed');
  }
});

module.exports = router;
