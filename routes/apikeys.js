const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const AlibabaProvider = require('../providers/alibaba');
const NvidiaProvider = require('../providers/nvidia');

const VALID_PROVIDERS = ['alibaba', 'cloudflare', 'nvidia', 'elevenlabs', 'pixazo'];
const PROVIDERS_NEEDING_WORKSPACE = new Set(['alibaba']);
const PROVIDERS_NEEDING_ACCOUNT = new Set(['cloudflare']);

// ──────────────────────────────────────────────
// GET /api/keys - list configured providers for the user (no secrets returned)
// ──────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT provider, workspace_id, account_id, is_active, updated_at
       FROM user_api_keys
       WHERE user_id = $1`,
      [req.user.id]
    );

    const byProvider = {};
    result.rows.forEach(row => {
      byProvider[row.provider] = {
        configured: true,
        is_active: row.is_active,
        workspace_id: row.workspace_id || null,
        account_id: row.account_id || null,
        updated_at: row.updated_at
      };
    });

    const keys = VALID_PROVIDERS.map(provider => ({
      provider,
      ...(byProvider[provider] || { configured: false, is_active: false, workspace_id: null, account_id: null })
    }));

    res.json({ success: true, keys });
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// POST /api/keys - upsert an API key for a provider
// body: { provider, api_key, workspace_id?, account_id? }
// ──────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  const { provider, api_key, workspace_id, account_id } = req.body;

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ success: false, message: 'Invalid provider' });
  }
  if (!api_key || !api_key.trim()) {
    return res.status(400).json({ success: false, message: 'API key is required' });
  }
  if (PROVIDERS_NEEDING_WORKSPACE.has(provider) && !workspace_id?.trim()) {
    return res.status(400).json({ success: false, message: 'Workspace ID is required for this provider' });
  }
  if (PROVIDERS_NEEDING_ACCOUNT.has(provider) && !account_id?.trim()) {
    return res.status(400).json({ success: false, message: 'Account ID is required for this provider' });
  }

  try {
    await pool.query(
      `INSERT INTO user_api_keys (user_id, provider, api_key, workspace_id, account_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         api_key = EXCLUDED.api_key,
         workspace_id = EXCLUDED.workspace_id,
         account_id = EXCLUDED.account_id,
         is_active = true,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, provider, api_key.trim(), workspace_id?.trim() || null, account_id?.trim() || null]
    );

    res.json({ success: true, message: `${provider} API key saved` });
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// POST /api/keys/:provider/test - live connectivity check
// ──────────────────────────────────────────────
router.post('/:provider/test', authenticateToken, async (req, res) => {
  const { provider } = req.params;

  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ success: false, message: 'Invalid provider' });
  }

  try {
    const result = await pool.query(
      `SELECT api_key, workspace_id, account_id FROM user_api_keys
       WHERE user_id = $1 AND provider = $2 AND is_active = true`,
      [req.user.id, provider]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: `No ${provider} key configured` });
    }

    const { api_key, workspace_id } = result.rows[0];

    if (provider === 'nvidia') {
      const nvidia = new NvidiaProvider(api_key);
      await nvidia.listModels();
      return res.json({ success: true, message: 'NVIDIA key is valid' });
    }

    if (provider === 'alibaba') {
      const alibaba = new AlibabaProvider(api_key, workspace_id);
      await alibaba.chatCompletion(
        [{ role: 'user', content: 'ping' }],
        { model: 'qwen-flash', max_tokens: 4 }
      );
      return res.json({ success: true, message: 'Alibaba key is valid' });
    }

    // No live test implemented yet for this provider — treat presence as OK.
    return res.json({ success: true, message: `${provider} key is saved (live test not implemented)` });

  } catch (error) {
    console.error(`Test ${provider} key error:`, error);
    res.status(400).json({ success: false, message: error.message || 'Connection test failed' });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/keys/:provider
// ──────────────────────────────────────────────
router.delete('/:provider', authenticateToken, async (req, res) => {
  const { provider } = req.params;

  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ success: false, message: 'Invalid provider' });
  }

  try {
    await pool.query(
      'DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2',
      [req.user.id, provider]
    );
    res.json({ success: true, message: `${provider} API key removed` });
  } catch (error) {
    console.error('Remove API key error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
