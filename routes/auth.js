const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';

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
      `INSERT INTO users (full_name, username, email, password_hash, role, subscription_tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, username, full_name, role, subscription_tier, trial_ends_at, created_at`,
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

    // Create default module access for trial user
    // Give access to: chatbot, coding-agent, social-content, message-writer, 
    // text-to-image, prompt-library, text-to-speech
    const freeModules = [
      'chatbot', 'coding-agent', 'social-content', 'message-writer',
      'text-to-image', 'prompt-library', 'text-to-speech'
    ];

    for (const moduleKey of freeModules) {
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
          [user.id, moduleResult.rows[0].id]
        );
      }
    }

    // Generate JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username,
        subscription_tier: 'trial',
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Return user (without password) + token
    const { password_hash, ...userWithoutPassword } = user;
    userWithoutPassword.subscription_tier = 'trial';
    userWithoutPassword.trial_ends_at = trialEndsAt;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: userWithoutPassword
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
              subscription_tier, trial_ends_at, is_active, created_at
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
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username,
        subscription_tier: user.subscription_tier,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: remember ? JWT_EXPIRY : '1d' } // 7 days if remember, else 1 day
    );

    // Remove password hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userWithoutPassword
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
              trial_ends_at, is_active, created_at
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
      user: user
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
              trial_ends_at, is_active, created_at, last_login_at
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
      user: result.rows[0]
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
       RETURNING id, email, username, full_name, role, subscription_tier, trial_ends_at, created_at, last_login_at`,
      [full_name, username, email, passwordHash, req.user.id]
    );

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

module.exports = router;