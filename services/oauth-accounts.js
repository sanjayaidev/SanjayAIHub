// ──────────────────────────────────────────────────────────────
// Shared account helpers for OAuth (Google/GitHub) sign-in.
//
// Lives outside routes/auth.js so it can also be imported from the
// coding-agent's ESM router (modules/coding-agent/server/routes/auth.js),
// which handles the GitHub OAuth *callback* itself — see the comment in
// that file for why GitHub login is wired through there instead of a
// second callback route in this app. Node's CJS/ESM interop lets an ESM
// file `import oauthAccounts from '.../services/oauth-accounts.js'` and
// destructure from the resulting module.exports object.
// ──────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';

// Modules every new account (password or OAuth signup) gets a free trial
// allowance for. Shared between /register and the OAuth find-or-create
// flow so both paths stay in sync.
const FREE_TRIAL_MODULES = [
  'chatbot', 'coding-agent', 'social-content', 'message-writer',
  'text-to-image', 'prompt-library', 'text-to-speech'
];

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

// Ensures a user_module_access row exists (and is_allowed = TRUE) for
// EVERY active module, not just the free-trial set above. The per-module
// tier gate in routes/modules.js (userTierLevel >= requiredLevel) is what
// actually restricts which modules a given tier can use — this function
// just makes sure the row exists at all, so that check isn't short-circuited
// by a missing/NULL `is_allowed` from an absent row. Call this whenever a
// user's subscription_tier changes (upgrade or downgrade), so newly
// unlocked modules aren't blocked by a stale/missing access row.
async function grantAllModuleAccess(userId, usageLimit = 100000) {
  await pool.query(
    `INSERT INTO user_module_access (user_id, module_id, is_allowed, usage_limit, used_count)
     SELECT $1, m.id, TRUE, $2, 0
     FROM modules m
     WHERE m.is_active = true
     ON CONFLICT (user_id, module_id) DO UPDATE
       SET is_allowed = TRUE`,
    [userId, usageLimit]
  );
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

module.exports = {
  grantDefaultModuleAccess,
  grantAllModuleAccess,
  issueToken,
  generateUniqueUsername,
  getBaseUrl,
  findOrCreateOAuthUser,
};
