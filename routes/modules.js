const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Import module handlers
const { chatbotHandler, getModelCatalog } = require('../modules/chatbot');
const promptLibrary = require('../modules/prompt-library');

// ──────────────────────────────────────────────
// GET /api/modules - List all modules with access
// ──────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         m.module_key,
         m.name,
         m.description,
         m.category,
         m.icon,
         m.access_level AS required_tier,
         m.is_public,
         uma.is_allowed,
         uma.usage_limit,
         uma.used_count,
         (uma.usage_limit - uma.used_count) AS remaining
       FROM modules m
       LEFT JOIN user_module_access uma 
         ON uma.module_id = m.id AND uma.user_id = $1
       WHERE m.is_active = true
       ORDER BY m.category, m.name`,
      [req.user.id]
    );

    const tierOrder = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
    const userTier = req.user.subscription_tier || 'trial';
    const userTierLevel = tierOrder[userTier] || 0;

    const modules = result.rows.map(mod => {
      const requiredLevel = tierOrder[mod.required_tier] || 0;
      const hasAccessByTier = userTierLevel >= requiredLevel;

      if (mod.is_allowed === null) {
        const isFree = mod.module_key === 'chatbot' || mod.module_key === 'prompt-library';
        const allowed = isFree || hasAccessByTier;
        return {
          ...mod,
          is_allowed: allowed,
          usage_limit: allowed ? (mod.required_tier === 'trial' ? 5 : 50) : 0,
          used_count: 0,
          remaining: allowed ? (mod.required_tier === 'trial' ? 5 : 50) : 0,
          requires_api_key: mod.module_key !== 'prompt-library'
        };
      }

      return {
        ...mod,
        is_allowed: mod.is_allowed && hasAccessByTier,
        requires_api_key: mod.module_key !== 'prompt-library'
      };
    });

    res.json({ success: true, modules });

  } catch (error) {
    console.error('List modules error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/chatbot/models
// Returns the model catalog available to the current user's tier
// (NVIDIA text-only for trial, full Alibaba catalog incl. vision for paid)
// ──────────────────────────────────────────────
router.get('/chatbot/models', authenticateToken, async (req, res) => {
  try {
    const userTier = req.user.subscription_tier || 'trial';
    const catalog = getModelCatalog(userTier);
    res.json({ success: true, ...catalog });
  } catch (error) {
    console.error('Get model catalog error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/usage/summary - Real usage stats for Profile > Usage
// ──────────────────────────────────────────────
router.get('/usage/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const byCategory = await pool.query(
      `SELECT m.category, COUNT(gh.id)::int AS count
       FROM generation_history gh
       JOIN modules m ON m.id = gh.module_id
       WHERE gh.user_id = $1
         AND gh.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY m.category`,
      [userId]
    );

    const credits = await pool.query(
      `SELECT 
         COALESCE(SUM(used_count), 0)::int AS used,
         COALESCE(SUM(usage_limit), 0)::int AS limit_total,
         COALESCE(SUM(GREATEST(usage_limit - used_count, 0)), 0)::int AS remaining
       FROM user_module_access
       WHERE user_id = $1`,
      [userId]
    );

    const categoryCounts = {};
    byCategory.rows.forEach(r => { categoryCounts[r.category] = r.count; });

    res.json({
      success: true,
      month: new Date().toISOString().slice(0, 7),
      chatMessages: categoryCounts.chat || 0,
      imagesGenerated: categoryCounts.image || 0,
      videosCreated: categoryCounts.video || 0,
      ttsGenerations: categoryCounts.audio || 0,
      creditsUsed: credits.rows[0].used,
      creditsRemaining: credits.rows[0].remaining
    });

  } catch (error) {
    console.error('Usage summary error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/:moduleKey - Execute module
// ──────────────────────────────────────────────
router.post('/:moduleKey', authenticateToken, async (req, res) => {
  const { moduleKey } = req.params;
  const userId = req.user.id;
  const userTier = req.user.subscription_tier || 'trial';

  try {
    const moduleCheck = await pool.query(
      `SELECT 
         m.id,
         m.module_key,
         m.name,
         m.access_level AS required_tier,
         m.config,
         uma.is_allowed,
         uma.usage_limit,
         uma.used_count,
         (uma.usage_limit - uma.used_count) AS remaining
       FROM modules m
       LEFT JOIN user_module_access uma 
         ON uma.module_id = m.id AND uma.user_id = $1
       WHERE m.module_key = $2 AND m.is_active = true`,
      [userId, moduleKey]
    );

    if (moduleCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const module = moduleCheck.rows[0];

    const tierOrder = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
    const userTierLevel = tierOrder[userTier] || 0;
    const requiredLevel = tierOrder[module.required_tier] || 0;

    const isFree = moduleKey === 'chatbot' || moduleKey === 'prompt-library';
    const hasAccess = isFree || (userTierLevel >= requiredLevel && module.is_allowed);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `This module requires ${module.required_tier} tier or higher`
      });
    }

    if (module.usage_limit > 0 && module.used_count >= module.usage_limit) {
      return res.status(429).json({
        success: false,
        message: 'Usage limit reached for this module',
        used: module.used_count,
        limit: module.usage_limit
      });
    }

    // ── Determine which provider keys this module needs ──
    // Chatbot is tier-dependent (NVIDIA for trial, Alibaba for paid), so we
    // fetch whichever key exists for the resolved provider instead of hard
    // requiring one specific provider up front.
    let requiredProviders = [];
    const providerMap = {
      'chatbot': ['nvidia', 'alibaba'],
      'coding-agent': ['nvidia'],
      'social-content': ['nvidia'],
      'message-writer': ['nvidia'],
      'text-to-image': ['alibaba'],
      'image-edit': ['alibaba', 'pixazo'],
      'text-to-video': ['alibaba'],
      'image-to-video': ['alibaba'],
      'video-to-video': ['alibaba'],
      'text-to-speech': ['cloudflare', 'elevenlabs'],
      'voice-clone': ['elevenlabs', 'alibaba'],
      'text-to-music': ['alibaba'],
      'design-studio': ['pixazo'],
      'chatbot-maker': ['alibaba'],
      'mcp-integrator': [],
      'prompt-library': []
    };

    requiredProviders = providerMap[moduleKey] || [];

    let apiKeys = {};
    if (requiredProviders.length > 0) {
      const keyResult = await pool.query(
        `SELECT provider, api_key, workspace_id, account_id 
         FROM user_api_keys 
         WHERE user_id = $1 AND provider = ANY($2) AND is_active = true`,
        [userId, requiredProviders]
      );

      keyResult.rows.forEach(row => {
        apiKeys[row.provider] = {
          api_key: row.api_key,
          workspace_id: row.workspace_id,
          account_id: row.account_id
        };
      });

      // Chatbot resolves its own required provider by tier inside the
      // handler, so it gives a precise "add your X key" error itself
      // instead of a generic missing-key 400 here.
      if (moduleKey !== 'chatbot') {
        const missingProviders = requiredProviders.filter(p => !apiKeys[p]);
        if (missingProviders.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Missing API keys for: ${missingProviders.join(', ')}`,
            missing: missingProviders
          });
        }
      }
    }

    // ── Route to appropriate module handler ──
    let result;
    switch (moduleKey) {
      case 'chatbot':
        result = await chatbotHandler(req.body, apiKeys, userId, userTier);
        break;
      // Note: 'prompt-library' is a browse/favorite experience, not a
      // generation action, so it doesn't go through this generic execute
      // endpoint — see the dedicated /prompt-library/* routes below.
      case 'text-to-image':
        result = await require('../modules/text-to-image')(req.body, apiKeys, userId);
        break;
      default:
        return res.status(501).json({
          success: false,
          message: `Module '${moduleKey}' not implemented yet`
        });
    }

    if (moduleKey !== 'prompt-library') {
      await pool.query(
        `UPDATE user_module_access 
         SET used_count = used_count + 1, 
             last_used_at = NOW()
         WHERE user_id = $1 AND module_id = $2`,
        [userId, module.id]
      );
    }

    await pool.query(
      `INSERT INTO generation_history 
       (user_id, module_id, module_key, prompt, parameters, model_used, status, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())`,
      [userId, module.id, moduleKey, req.body.prompt || 'Chat interaction', JSON.stringify(req.body), result?.model || req.body.model || 'unknown']
    );

    res.json({
      success: true,
      data: result,
      remaining: module.usage_limit > 0 ? (module.usage_limit - module.used_count - 1) : null
    });

  } catch (error) {
    console.error(`Module ${moduleKey} error:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'Module execution failed'
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/chat/threads - Get user's chat threads
// ──────────────────────────────────────────────
router.get('/chat/threads', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, model, created_at, updated_at
       FROM chat_threads
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, threads: result.rows });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/chat/threads/:threadId/messages
// ──────────────────────────────────────────────
router.get('/chat/threads/:threadId/messages', authenticateToken, async (req, res) => {
  const { threadId } = req.params;
  try {
    const threadCheck = await pool.query(
      'SELECT id FROM chat_threads WHERE id = $1 AND user_id = $2',
      [threadId, req.user.id]
    );
    if (threadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    const result = await pool.query(
      `SELECT id, role, content, attachments, model_used, token_count, created_at
       FROM chat_messages
       WHERE thread_id = $1
       ORDER BY created_at ASC`,
      [threadId]
    );
    res.json({ success: true, messages: result.rows });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/modules/chat/threads/:threadId
// ──────────────────────────────────────────────
router.delete('/chat/threads/:threadId', authenticateToken, async (req, res) => {
  const { threadId } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM chat_threads WHERE id = $1 AND user_id = $2 RETURNING id',
      [threadId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }
    res.json({ success: true, message: 'Thread deleted' });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// PUT /api/modules/chat/threads/:threadId - Rename thread
// ──────────────────────────────────────────────
router.put('/chat/threads/:threadId', authenticateToken, async (req, res) => {
  const { threadId } = req.params;
  const { title } = req.body;

  if (!title || title.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }

  try {
    const result = await pool.query(
      'UPDATE chat_threads SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
      [title.trim(), threadId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }
    res.json({ success: true, message: 'Thread updated' });
  } catch (error) {
    console.error('Rename thread error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/prompt-library/prompts - Browse curated prompts
// Public: prompt-library is a free module, browsing doesn't require login.
// Query: ?category=text-to-image&subCategory=Urban&search=dragon&sort=popular
// ──────────────────────────────────────────────
router.get('/prompt-library/prompts', async (req, res) => {
  try {
    const { category, subCategory, search, sort } = req.query;
    const prompts = await promptLibrary.listPrompts({
      moduleKey: category,
      subCategory,
      search,
      sort,
    });
    res.json({ success: true, prompts });
  } catch (error) {
    console.error('List prompts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/prompt-library/favorites - Current user's favorited prompt IDs
// ──────────────────────────────────────────────
router.get('/prompt-library/favorites', authenticateToken, async (req, res) => {
  try {
    const favorites = await promptLibrary.getFavoriteIds(req.user.id);
    res.json({ success: true, favorites });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/prompt-library/favorites/:promptId - Toggle favorite
// ──────────────────────────────────────────────
router.post('/prompt-library/favorites/:promptId', authenticateToken, async (req, res) => {
  try {
    const result = await promptLibrary.toggleFavorite(req.user.id, req.params.promptId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/prompt-library/:promptId/view - Increment view counter
// ──────────────────────────────────────────────
router.post('/prompt-library/:promptId/view', async (req, res) => {
  try {
    await promptLibrary.incrementView(req.params.promptId);
    res.json({ success: true });
  } catch (error) {
    console.error('Increment view error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
