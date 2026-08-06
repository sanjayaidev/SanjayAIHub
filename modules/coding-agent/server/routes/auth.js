// routes/auth.js
import express from 'express';
import crypto from 'crypto';
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
  return `${base}/agent/api/auth/github/callback`;
}

// Step 1: kick off GitHub OAuth
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    scope: 'repo read:user user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Step 2: GitHub redirects back here with a code
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;

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
    const token = await exchangeCodeForToken(code, getRedirectUri(req));
    const user = await getGithubUser(token);

    req.session.githubToken = token;
    req.session.user = {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      email: user.email,
    };

    res.redirect('/');
  } catch (error) {
    console.error('[Auth] OAuth callback failed:', error);
    res.status(500).send(`Login failed: ${error.message}`);
  }
});

// Current session's user, if any
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({ user: req.session.user });
});

// Log out
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
