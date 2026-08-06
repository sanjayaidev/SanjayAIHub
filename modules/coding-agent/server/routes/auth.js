// routes/auth.js
import express from 'express';
import crypto from 'crypto';
import pool from '../../../../db/index.js';
import { exchangeCodeForToken, getGithubUser } from '../lib/github.js';

const router = express.Router();

// Both the authorize redirect and the token exchange must send the EXACT
// same redirect_uri GitHub has registered for this OAuth App, or GitHub
// rejects the exchange (this is what was showing up as a broken/failed
// callback even though GITHUB_CLIENT_ID/SECRET were set correctly).
// Two things commonly break this:
//   1. APP_BASE_URL having a trailing slash (or any other stray
//      formatting) so the built URL doesn't byte-for-byte match what's
//      registered on GitHub.
//   2. APP_BASE_URL not being set at all — this used to silently produce
//      "undefined/agent/api/auth/github/callback".
// Deriving from the incoming request as a fallback, and normalizing away
// a trailing slash, makes this self-correcting on Railway (and anywhere
// else) without relying on getting APP_BASE_URL formatted exactly right.
function getRedirectUri(req) {
  const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const redirectUri = `${base}/agent/api/auth/github/callback`;
  console.log('[Auth] getRedirectUri returning:', redirectUri);
  return redirectUri;
}

// Step 1: kick off GitHub OAuth
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  
  // Also store mainUserId if available from main app session
  if (req.session.mainUserId) {
    console.log('[Auth] mainUserId available for OAuth:', req.session.mainUserId);
  } else {
    console.warn('[Auth] No mainUserId in session - user may not be logged into main app');
  }
  
  console.log('[Auth] Starting OAuth flow');
  console.log('[Auth] Generated state:', state);
  console.log('[Auth] Session ID:', req.sessionID);

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    scope: 'repo read:user user:email',
    state,
  });

  console.log('[Auth] Redirecting to GitHub with params:', params.toString());
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Step 2: GitHub redirects back here with a code
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('[Auth] Callback received');
  console.log('[Auth] Code present:', !!code);
  console.log('[Auth] State from query:', state);
  console.log('[Auth] State from session:', req.session.oauthState);
  console.log('[Auth] Session ID:', req.sessionID);

  if (!code || !state || state !== req.session.oauthState) {
    // Most common cause on a platform like Railway: the session cookie
    // from step 1 didn't come back (e.g. the app restarted/rescaled
    // between the two requests and the in-memory session store lost it).
    console.error('[Auth] OAuth state mismatch', {
      hasCode: !!code,
      hasState: !!state,
      hasSessionState: !!req.session.oauthState,
    });
    return res.status(400).send('Invalid OAuth state. Please try logging in again.');
  }
  delete req.session.oauthState;

  try {
    const redirectUri = getRedirectUri(req);
    console.log('[Auth] Exchanging code for token with redirect_uri:', redirectUri);
    const tokenResponse = await exchangeCodeForToken(code, redirectUri);
    console.log('[Auth] Token received, fetching user info');
    const user = await getGithubUser(tokenResponse.access_token || tokenResponse);
    console.log('[Auth] User info received:', user.login);

    const accessToken = tokenResponse.access_token || tokenResponse;
    const tokenScope = tokenResponse.scope || '';

    req.session.githubToken = accessToken;
    req.session.user = {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      email: user.email,
    };

    // Store GitHub connection in database
    try {
      // Get the main app user ID from session (passed from main auth system)
      const mainUserId = req.session.mainUserId;
      
      if (mainUserId) {
        console.log('[Auth] Storing GitHub connection for user:', mainUserId);
        
        // Check if connection already exists
        const existingConnection = await pool.query(
          'SELECT id FROM user_github_connections WHERE user_id = $1 AND github_user_id = $2',
          [mainUserId, String(user.id)]
        );

        if (existingConnection.rows.length > 0) {
          // Update existing connection
          await pool.query(
            `UPDATE user_github_connections 
             SET access_token = $1, 
                 github_username = $2,
                 github_name = $3,
                 github_email = $4,
                 github_avatar_url = $5,
                 scope = $6,
                 is_active = true,
                 last_synced_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $7 AND github_user_id = $8`,
            [accessToken, user.login, user.name || user.login, user.email, user.avatar_url, 
             tokenScope, mainUserId, String(user.id)]
          );
          console.log('[Auth] GitHub connection updated');
        } else {
          // Create new connection
          await pool.query(
            `INSERT INTO user_github_connections 
             (user_id, github_user_id, github_username, github_name, github_email, 
              github_avatar_url, access_token, token_type, scope, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
            [mainUserId, String(user.id), user.login, user.name || user.login, 
             user.email, user.avatar_url, accessToken, 'bearer', tokenScope]
          );
          console.log('[Auth] GitHub connection created');
        }
      } else {
        console.warn('[Auth] No mainUserId in session - skipping DB storage');
      }
    } catch (dbError) {
      console.error('[Auth] Failed to store GitHub connection in DB:', dbError.message);
      // Don't fail the OAuth flow if DB storage fails
    }

    console.log('[Auth] Session updated, redirecting to /');
    res.redirect('/');
  } catch (error) {
    console.error('[Auth] OAuth callback failed:', error);
    res.status(500).send(`Login failed: ${error.message}`);
  }
});

// Current session's user, if any
router.get('/me', async (req, res) => {
  try {
    // First check session
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    // Try to load connection status from DB
    const mainUserId = req.session.mainUserId;
    
    if (mainUserId) {
      try {
        const result = await pool.query(
          `SELECT github_username, github_name, github_avatar_url, scope, is_active, last_synced_at 
           FROM user_github_connections 
           WHERE user_id = $1 AND is_active = true`,
          [mainUserId]
        );

        if (result.rows.length > 0) {
          const connection = result.rows[0];
          return res.json({ 
            user: req.session.user,
            connected: true,
            connection: {
              username: connection.github_username,
              name: connection.github_name,
              avatarUrl: connection.github_avatar_url,
              scope: connection.scope,
              lastSyncedAt: connection.last_synced_at
            }
          });
        }
      } catch (dbError) {
        console.error('[Auth] Failed to load GitHub connection from DB:', dbError.message);
      }
    }

    // Fallback to session-only data
    return res.json({ 
      user: req.session.user,
      connected: !!req.session.githubToken
    });
  } catch (error) {
    console.error('[Auth] /me failed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Log out
router.post('/logout', (req, res) => {
  const mainUserId = req.session.mainUserId;
  
  // Also deactivate the GitHub connection in DB if mainUserId exists
  if (mainUserId) {
    pool.query(
      'UPDATE user_github_connections SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [mainUserId]
    ).catch(err => {
      console.error('[Auth] Failed to deactivate GitHub connection on logout:', err.message);
    });
  }
  
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Get GitHub access token for the connected account (for verification/debugging)
router.get('/github/token', async (req, res) => {
  try {
    if (!req.session.mainUserId) {
      return res.status(401).json({ error: 'Not logged into main app' });
    }
    
    if (!req.session.githubToken) {
      return res.status(401).json({ error: 'GitHub not connected' });
    }
    
    // Load connection details from DB
    const result = await pool.query(
      `SELECT github_username, scope, is_active, last_synced_at, created_at
       FROM user_github_connections 
       WHERE user_id = $1 AND is_active = true`,
      [req.session.mainUserId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active GitHub connection found' });
    }
    
    const connection = result.rows[0];
    
    // Return token info (token itself should be used internally, not exposed)
    res.json({
      connected: true,
      username: connection.github_username,
      scope: connection.scope,
      isActive: connection.is_active,
      lastSyncedAt: connection.last_synced_at,
      createdAt: connection.created_at,
      // Note: We don't expose the full token to the frontend for security
      // The token is stored securely in the session and DB
      tokenPreview: req.session.githubToken 
        ? req.session.githubToken.substring(0, 8) + '...' + req.session.githubToken.substring(req.session.githubToken.length - 4)
        : null
    });
  } catch (error) {
    console.error('[Auth] /github/token failed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Disconnect GitHub account
router.post('/github/disconnect', async (req, res) => {
  try {
    const mainUserId = req.session.mainUserId;
    
    if (!mainUserId) {
      return res.status(401).json({ error: 'Not logged into main app' });
    }
    
    // Deactivate all GitHub connections for this user
    await pool.query(
      'UPDATE user_github_connections SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [mainUserId]
    );
    
    // Clear session data
    delete req.session.githubToken;
    delete req.session.user;
    
    console.log('[Auth] GitHub disconnected for user:', mainUserId);
    res.json({ success: true, message: 'GitHub account disconnected' });
  } catch (error) {
    console.error('[Auth] /github/disconnect failed:', error);
    res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

export default router;
