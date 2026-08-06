// server/lib/githubAuth.js
//
// Single source of truth for "is this user connected to GitHub, and what's
// their token?" for the coding-agent.
//
// Why this exists
// ----------------
// req.session.githubToken / req.session.user used to be the ONLY place the
// rest of the app looked for GitHub auth (see routes/auth.js `/me`,
// routes/repos.js `requireAuth`, etc). Those two keys are written exactly
// once, inside the OAuth callback. That's a problem because:
//
//   1. express-session here uses the default in-memory MemoryStore, so a
//      server restart/redeploy (Railway does this on every deploy) wipes
//      every session's githubToken/user, even though the token is safely
//      sitting in the `user_github_connections` table.
//   2. Any other tab/device/browser session for the same logged-in main
//      app user never had those keys set in the first place, even though
//      the DB row exists.
//
// In both cases `req.session.mainUserId` still gets re-established on the
// next visit to /agent (server.js verifies the main app's JWT and stashes
// mainUserId in the shared session — see the `/agent` middleware in
// server.js), so we always have an independent way to identify *who* is
// asking, even when the GitHub-specific session keys are gone. This module
// uses that identity to fetch the persisted token from the DB and re-
// hydrates the session with it, so the UI stops asking the user to
// "Connect GitHub" when they're already connected.
import pool from '../../../../db/index.js';

/**
 * Resolve the current request's GitHub auth (access token + profile).
 *
 * Resolution order:
 *   1. Already-hydrated session (fast path, no DB hit).
 *   2. mainUserId (independently identifies the logged-in main-app user
 *      for *this* session/request) -> look up the active row in
 *      user_github_connections -> hydrate the session for next time.
 *
 * Returns null if neither source has an active connection.
 */
export async function resolveGithubAuth(req) {
  // 1. Fast path — this session already has a live token.
  if (req.session.githubToken && req.session.user) {
    return { token: req.session.githubToken, user: req.session.user, source: 'session' };
  }

  // 2. Independently identify the main-app user for this request. This is
  //    NOT read from anything cached on this module — it comes from the
  //    shared session, set by server.js after verifying the main app's
  //    JWT, so it reflects who is actually logged in right now.
  const mainUserId = req.session.mainUserId;
  if (!mainUserId) {
    return null;
  }

  try {
    const result = await pool.query(
      `SELECT github_user_id, github_username, github_name, github_email,
              github_avatar_url, access_token, scope, last_synced_at
       FROM user_github_connections
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [mainUserId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const user = {
      login: row.github_username,
      name: row.github_name || row.github_username,
      avatarUrl: row.github_avatar_url,
      email: row.github_email,
    };

    // Re-hydrate the session so subsequent requests in this session hit
    // the fast path above instead of round-tripping to the DB every time.
    req.session.githubToken = row.access_token;
    req.session.user = user;

    return {
      token: row.access_token,
      user,
      source: 'db',
      scope: row.scope,
      lastSyncedAt: row.last_synced_at,
    };
  } catch (err) {
    console.error('[GithubAuth] Failed to resolve GitHub auth from DB:', err.message);
    return null;
  }
}

/**
 * Express middleware version of resolveGithubAuth — attaches the result to
 * req.githubAuth, or responds 401 if there's no active connection.
 */
export async function requireGithubAuth(req, res, next) {
  try {
    const auth = await resolveGithubAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Not logged in. Visit /agent/api/auth/github to log in.' });
    }
    req.githubAuth = auth;
    next();
  } catch (err) {
    console.error('[GithubAuth] requireGithubAuth failed:', err.message);
    res.status(500).json({ error: 'Server error while checking GitHub connection' });
  }
}
