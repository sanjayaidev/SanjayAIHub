const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const pixazoTrial = require('../config/pixazo-trial');
const { validateEmailDomain } = require('../config/allowed-email-domains');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';

// Modules every new account (password or OAuth signup) gets a free trial
// allowance for. Shared between /register and the Google/GitHub
// find-or-create flow so both paths stay in sync.
const FREE_TRIAL_MODULES = [
  'chatbot', 'coding-agent', 'social-content', 'message-writer',
  'text-to-image', 'prompt-library', 'text-to-speech'
];

// Attaches the shared-Pixazo-trial feature flag + limit to a user object
// returned to the client, so the frontend can gate module cards / render
// trial status without a separate round trip. The live used_count always
// comes straight from the users table column selected in each query below.
function withPixazoTrialInfo(user) {
  return {
    ...user,
    pixazo_trial_enabled: pixazoTrial.ENABLED,
    pixazo_trial_limit: pixazoTrial.LIMIT,
  };
}

// Grants the default trial module access rows for a brand-new user.
// Used by both password registration and first-time Google/GitHub signup.
async function grantDefaultModuleAccess(userId) {
  for (const moduleKey of FREE_TRIAL_MODULES) {
    const moduleResult = await pool.query(
      'SELECT id FROM modules WHERE module_key = $1',
      [moduleKey]
    );

    if (moduleResult.rows.length > 0) {
      await pool.query(
        `INSERT INTO user_module_access (user_id, module_id, usage_limit, used_count)
         SELECT $1, $2, 5, 0
         WHERE NOT EXISTS (
           SELECT 1 FROM user_module_access WHERE user_id = $1 AND module_id = $2
         )`,
        [userId, moduleResult.rows[0].id]
      );
    }
  }
}

// Signs the standard app JWT for a user row.
function issueToken(user, expiresIn = JWT_EXPIRY) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      subscription_tier: user.subscription_tier,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn }
  );
}

// Turns an email-local-part / display name into a free, valid, unique
// username (letters/numbers/underscores, 3-20 chars) for OAuth signups
// that don't go through the register form's username field.
async function generateUniqueUsername(base) {
  let cleaned = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 15);
  if (cleaned.length < 3) cleaned = (cleaned + 'user').slice(0, 15);

  let candidate = cleaned;
  let suffix = 0;
  // Bounded loop: extremely unlikely to need more than a handful of tries.
  while (suffix < 1000) {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [candidate]);
    if (existing.rows.length === 0) return candidate;
    suffix += 1;
    candidate = `${cleaned}${suffix}`.slice(0, 20);
  }
  // Last-resort fallback, effectively unique.
  return `${cleaned}${Date.now()}`.slice(0, 20);
}

// Resolves the public base URL to build OAuth redirect URIs from.
// Prefers APP_BASE_URL (set this in production) and normalizes away a
// trailing slash so redirect_uri matches byte-for-byte what's registered
// with Google/GitHub.
function getBaseUrl(req) {
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/+$/, '');
}

// Finds an existing user linked to this OAuth provider identity, links
// the provider to a matching-email account if one already exists (e.g.
// they originally signed up with a password), or creates a brand-new
// account. OAuth-verified emails skip the Gmail/Yahoo/Rediff allow-list
// that applies to password signups, since Google/GitHub have already
// verified the address themselves.
async function findOrCreateOAuthUser({ provider, providerId, email, name, avatarUrl }) {
  const idColumn = provider === 'google' ? 'google_id' : 'github_id';
  const selectCols = `id, email, username, full_name, role, subscription_tier,
    trial_ends_at, is_active, created_at, pixazo_trial_used_count, auth_provider`;

  // 1) Already linked to this provider account.
  let result = await pool.query(
    `SELECT ${selectCols} FROM users WHERE ${idColumn} = $1`,
    [providerId]
  );
  if (result.rows.length > 0) {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [result.rows[0].id]);
    return result.rows[0];
  }

  // 2) An account with this email already exists (e.g. password signup) —
  //    link this provider to it rather than creating a duplicate account.
  result = await pool.query(
    `SELECT ${selectCols} FROM users WHERE email = $1`,
    [email]
  );
  if (result.rows.length > 0) {
    const existing = result.rows[0];
    await pool.query(
      `UPDATE users
       SET ${idColumn} = $1,
           avatar_url = COALESCE(avatar_url, $2),
           email_verified = TRUE,
           last_login_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [providerId, avatarUrl || null, existing.id]
    );
    return existing;
  }

  // 3) Brand-new account.
  const username = await generateUniqueUsername((email.split('@')[0] || name));
  const insertResult = await pool.query(
    `INSERT INTO users
       (full_name, username, email, password_hash, role, subscription_tier,
        auth_provider, ${idColumn}, avatar_url, email_verified)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, TRUE)
     RETURNING ${selectCols}`,
    [name || username, username, email, 'user', 'trial', provider, providerId, avatarUrl || null]
  );
  const newUser = insertResult.rows[0];

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 7);
  await pool.query(
    'UPDATE users SET trial_ends_at = $1, last_login_at = CURRENT_TIMESTAMP WHERE id = $2',
    [trialEndsAt, newUser.id]
  );
  newUser.trial_ends_at = trialEndsAt;

  await grantDefaultModuleAccess(newUser.id);

  return newUser;
}

// ──────────────────────────────────────────────
// REGISTER
// ──────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { full_name, username, email, password } = req.body;

  // Validation
  if (!full_name || !username || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required'
    });
  }

  if (username.length < 3 || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username must be 3-20 characters (letters, numbers, underscores)'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address'
    });
  }

  // Email-provider gating: password-based signup is restricted to
  // well-known, verified consumer mail providers (Gmail/Yahoo/Rediff)
  // and blocks disposable/temp-mail domains. Google/GitHub sign-in are
  // exempt — see the /google and /github routes below.
  const emailDomainCheck = validateEmailDomain(email);
  if (!emailDomainCheck.allowed) {
    return res.status(400).json({
      success: false,
      message: emailDomainCheck.reason
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters'
    });
  }

  try {
    // Check if username or email exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username or email already registered'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role, subscription_tier, auth_provider)
       VALUES ($1, $2, $3, $4, $5, $6, 'local')
       RETURNING id, email, username, full_name, role, subscription_tier, trial_ends_at, created_at, pixazo_trial_used_count`,
      [full_name, username, email, passwordHash, 'user', 'trial']
    );

    const user = result.rows[0];

    // Set trial expiry to 7 days from now
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
    await pool.query(
      'UPDATE users SET trial_ends_at = $1 WHERE id = $2',
      [trialEndsAt, user.id]
    );

    // Create default module access for trial user (chatbot, coding-agent,
    // social-content, message-writer, text-to-image, prompt-library,
    // text-to-speech)
    await grantDefaultModuleAccess(user.id);

    // Generate JWT
    const token = issueToken({ ...user, subscription_tier: 'trial' });

    // Return user (without password) + token
    const { password_hash, ...userWithoutPassword } = user;
    userWithoutPassword.subscription_tier = 'trial';
    userWithoutPassword.trial_ends_at = trialEndsAt;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: withPixazoTrialInfo(userWithoutPassword)
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// ──────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { identifier, password, remember } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email/Username and password are required'
    });
  }

  try {
    // Find user by email OR username
    const result = await pool.query(
      `SELECT id, email, username, full_name, password_hash, role, 
              subscription_tier, trial_ends_at, is_active, created_at,
              pixazo_trial_used_count, auth_provider
       FROM users
       WHERE email = $1 OR username = $1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is disabled. Please contact support.'
      });
    }

    // Accounts created via Google/GitHub have no password set — send them
    // back to the right button instead of a confusing "invalid credentials".
    if (!user.password_hash) {
      const providerLabel = user.auth_provider === 'google' ? 'Google' : 'GitHub';
      return res.status(400).json({
        success: false,
        message: `This account uses ${providerLabel} sign-in. Please continue with ${providerLabel} instead.`
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last_login_at
    await pool.query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT
    const token = issueToken(user, remember ? JWT_EXPIRY : '1d'); // 7 days if remember, else 1 day

    // Remove password hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: withPixazoTrialInfo(userWithoutPassword)
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// ──────────────────────────────────────────────
// VERIFY TOKEN
// ──────────────────────────────────────────────
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    // Get fresh user data from DB
    const result = await pool.query(
      `SELECT id, email, username, full_name, role, subscription_tier, 
              trial_ends_at, is_active, created_at, pixazo_trial_used_count,
              auth_provider, avatar_url
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is disabled'
      });
    }

    res.json({
      success: true,
      user: withPixazoTrialInfo(user)
    });

  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ──────────────────────────────────────────────
// GET CURRENT USER (ME)
// ──────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, username, full_name, role, subscription_tier, 
              trial_ends_at, is_active, created_at, last_login_at,
              pixazo_trial_used_count, auth_provider, avatar_url
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: withPixazoTrialInfo(result.rows[0])
    });

  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ──────────────────────────────────────────────
// LOGOUT (Client-side only, but kept for completeness)
// ──────────────────────────────────────────────
router.post('/logout', authenticateToken, (req, res) => {
  // With JWT, logout is client-side (delete token)
  // But we can optionally blacklist tokens here in the future
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ──────────────────────────────────────────────
// GET MODULE ACCESS FOR USER
// ──────────────────────────────────────────────
router.get('/modules/access', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         m.module_key,
         m.name,
         m.category,
         m.access_level AS required_tier,
         uma.is_allowed,
         uma.usage_limit,
         uma.used_count,
         (uma.usage_limit - uma.used_count) AS remaining
       FROM modules m
       LEFT JOIN user_module_access uma 
         ON uma.module_id = m.id AND uma.user_id = $1
       WHERE m.is_active = true
       ORDER BY m.category, m.module_key`,
      [req.user.id]
    );

    // Determine access based on subscription tier
    const tierOrder = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
    const userTier = req.user.subscription_tier || 'trial';
    const userTierLevel = tierOrder[userTier] || 0;

    const modules = result.rows.map(mod => {
      const requiredLevel = tierOrder[mod.required_tier] || 0;
      const hasAccessByTier = userTierLevel >= requiredLevel;
      
      // If no access record exists, create default based on tier
      if (mod.is_allowed === null) {
        return {
          ...mod,
          is_allowed: hasAccessByTier,
          usage_limit: hasAccessByTier ? (mod.required_tier === 'trial' ? 5 : 50) : 0,
          used_count: 0,
          remaining: hasAccessByTier ? (mod.required_tier === 'trial' ? 5 : 50) : 0
        };
      }

      return {
        ...mod,
        is_allowed: mod.is_allowed && hasAccessByTier
      };
    });

    res.json({
      success: true,
      modules
    });

  } catch (error) {
    console.error('Module access error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ──────────────────────────────────────────────
// UPDATE CURRENT USER (Profile > Personal Information)
// ──────────────────────────────────────────────
router.put('/me', authenticateToken, async (req, res) => {
  const { full_name, username, email, current_password, new_password } = req.body;

  if (!full_name || !username || !email) {
    return res.status(400).json({
      success: false,
      message: 'Full name, username, and email are required'
    });
  }

  if (username.length < 3 || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username must be 3-20 characters (letters, numbers, underscores)'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address'
    });
  }

  const emailDomainCheck = validateEmailDomain(email);
  if (!emailDomainCheck.allowed) {
    return res.status(400).json({
      success: false,
      message: emailDomainCheck.reason
    });
  }

  try {
    // Username/email uniqueness (excluding this user)
    const existing = await pool.query(
      'SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3',
      [username, email, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username or email already in use'
      });
    }

    let passwordHash = null;
    if (new_password) {
      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters'
        });
      }
      if (!current_password) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to set a new password'
        });
      }

      const userRow = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const isValid = await bcrypt.compare(current_password, userRow.rows[0].password_hash);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
      passwordHash = await bcrypt.hash(new_password, 12);
    }

    const result = await pool.query(
      `UPDATE users
       SET full_name = $1, username = $2, email = $3,
           password_hash = COALESCE($4, password_hash),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, email, username, full_name, role, subscription_tier, trial_ends_at, created_at, last_login_at, pixazo_trial_used_count`,
      [full_name, username, email, passwordHash, req.user.id]
    );

    result.rows[0] = withPixazoTrialInfo(result.rows[0]);

    res.json({
      success: true,
      message: 'Profile updated',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile'
    });
  }
});

// ──────────────────────────────────────────────
// GOOGLE OAUTH LOGIN
// ──────────────────────────────────────────────

// Step 1: kick off Google OAuth
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).send('GOOGLE_CLIENT_ID is not configured on the server.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleOauthState = state;

  const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: Google redirects back here with a code
router.get('/google/callback', async (req, res) => {
  const { code, state, error: googleError } = req.query;

  if (googleError) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Google sign-in was cancelled.')}`);
  }

  if (!code || !state || state !== req.session.googleOauthState) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Invalid or expired Google login attempt. Please try again.')}`);
  }
  delete req.session.googleOauthState;

  try {
    const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to obtain Google access token');
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) {
      throw new Error(`Google userinfo request failed: ${profileRes.status}`);
    }
    const profile = await profileRes.json();

    // Google's own account verification is what we rely on here — only
    // proceed if Google itself says the email is verified.
    if (!profile.email || profile.email_verified !== true) {
      return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Your Google account email is not verified.')}`);
    }

    const user = await findOrCreateOAuthUser({
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      name: profile.name || profile.email.split('@')[0],
      avatarUrl: profile.picture || null,
    });

    if (!user.is_active) {
      return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Account is disabled. Please contact support.')}`);
    }

    const token = issueToken(user);
    return res.redirect(`/login.html?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Google sign-in failed. Please try again.')}`);
  }
});

// ──────────────────────────────────────────────
// GITHUB OAUTH LOGIN
// (Separate from the coding-agent's GitHub *repo connection* flow at
// /agent/api/auth/github — this one is for signing into SanjayAIHub
// itself. It reuses the same GITHUB_CLIENT_ID/SECRET OAuth App; add
// APP_BASE_URL + '/api/auth/github/callback' as an additional
// "Authorization callback URL" on that GitHub OAuth App.)
// ──────────────────────────────────────────────

// Step 1: kick off GitHub OAuth
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured on the server.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.githubLoginState = state;

  const redirectUri = `${getBaseUrl(req)}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
    allow_signup: 'true',
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Step 2: GitHub redirects back here with a code
router.get('/github/callback', async (req, res) => {
  const { code, state, error: githubError } = req.query;

  if (githubError) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('GitHub sign-in was cancelled.')}`);
  }

  if (!code || !state || state !== req.session.githubLoginState) {
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Invalid or expired GitHub login attempt. Please try again.')}`);
  }
  delete req.session.githubLoginState;

  try {
    const redirectUri = `${getBaseUrl(req)}/api/auth/github/callback`;

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to obtain GitHub access token');
    }
    const accessToken = tokenData.access_token;

    const profileRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!profileRes.ok) {
      throw new Error(`GitHub /user request failed: ${profileRes.status}`);
    }
    const profile = await profileRes.json();

    // profile.email is only populated if the user made it public — fetch
    // /user/emails (covered by the user:email scope) to get the actual
    // verified primary address.
    let email = profile.email;
    let emailVerified = !!email;
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified) || emails[0];
      if (primary) {
        email = primary.email;
        emailVerified = !!primary.verified;
      }
    }

    if (!email || !emailVerified) {
      return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Your GitHub account has no verified email address.')}`);
    }

    const user = await findOrCreateOAuthUser({
      provider: 'github',
      providerId: String(profile.id),
      email,
      name: profile.name || profile.login,
      avatarUrl: profile.avatar_url || null,
    });

    if (!user.is_active) {
      return res.redirect(`/login.html?oauth_error=${encodeURIComponent('Account is disabled. Please contact support.')}`);
    }

    const token = issueToken(user);
    return res.redirect(`/login.html?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    return res.redirect(`/login.html?oauth_error=${encodeURIComponent('GitHub sign-in failed. Please try again.')}`);
  }
});

module.exports = router;