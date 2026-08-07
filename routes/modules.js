const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Import module handlers
const { chatbotHandler, getModelCatalog: getChatModelCatalog } = require('../modules/chatbot');
const promptLibrary = require('../modules/prompt-library');
const { messageWriterHandler, getModelCatalog: getMessageModelCatalog } = require('../modules/message-writer');
const { contentCreatorHandler, getModelCatalog: getContentModelCatalog } = require('../modules/content-creator');
const { ttsHandler, getModelCatalog: getTTSModelCatalog } = require('../modules/text-to-speech');
const { textToImageHandler, getModelCatalog: getImageModelCatalog } = require('../modules/text-to-image');
const { imageToImageHandler, getModelCatalog: getImageEditModelCatalog } = require('../modules/image-to-image');
const { textToVideoHandler, checkVideoStatus: checkT2VStatus, getModelCatalog: getVideoModelCatalog } = require('../modules/text-to-video');
const { imageToVideoHandler, checkVideoStatus: checkI2VStatus, getModelCatalog: getImageToVideoModelCatalog } = require('../modules/image-to-video');
const { videoToVideoHandler, checkVideoStatus: checkV2VStatus, getModelCatalog: getVideoToVideoModelCatalog } = require('../modules/video-to-video');
const { textToMusicHandler, checkAudioStatus, getModelCatalog: getMusicModelCatalog } = require('../modules/text-to-music');
const { voiceCloneHandler, synthesizeHandler: voiceSynthesizeHandler, listVoicesHandler, getModelCatalog: getVoiceCloneModelCatalog } = require('../modules/voice-clone');

// ── Temporary shared key (free-tier text models only) ──
// Optional shared NVIDIA key so trial users without their own key can still
// try the text modules a few times (gated by their existing per-module
// usage_limit) before being asked to add their own. Leave unset in .env to
// disable this entirely — the app behaves exactly as before.
const TEMP_NVIDIA_API_KEY = process.env.NVIDIA_FREE_TIER_API_KEY || '';
const TEMPORARY_KEY_MODULES = new Set(['chatbot', 'message-writer', 'social-content']);

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

    // Does this user already have their own NVIDIA key? Only relevant for
    // deciding whether to offer the shared temporary key on text modules.
    let hasOwnNvidiaKey = false;
    if (TEMP_NVIDIA_API_KEY && userTierLevel === 0) {
      const nvidiaKeyResult = await pool.query(
        `SELECT 1 FROM user_api_keys WHERE user_id = $1 AND provider = 'nvidia' AND is_active = true LIMIT 1`,
        [req.user.id]
      );
      hasOwnNvidiaKey = nvidiaKeyResult.rows.length > 0;
    }

    const modules = result.rows.map(mod => {
      const requiredLevel = tierOrder[mod.required_tier] || 0;
      const hasAccessByTier = userTierLevel >= requiredLevel;

      // Free/trial users without their own NVIDIA key can borrow the app's
      // shared key for a limited number of messages on text modules — see
      // TEMPORARY_KEY_MODULES / NVIDIA_FREE_TIER_API_KEY above.
      const supportsTemporaryKey = TEMPORARY_KEY_MODULES.has(mod.module_key)
        && !!TEMP_NVIDIA_API_KEY
        && userTierLevel === 0
        && !hasOwnNvidiaKey;

      if (mod.is_allowed === null) {
        const isFree = mod.module_key === 'chatbot' || mod.module_key === 'prompt-library';
        const allowed = isFree || hasAccessByTier;
        return {
          ...mod,
          is_allowed: allowed,
          usage_limit: allowed ? (mod.required_tier === 'trial' ? 5 : 50) : 0,
          used_count: 0,
          remaining: allowed ? (mod.required_tier === 'trial' ? 5 : 50) : 0,
          requires_api_key: mod.module_key !== 'prompt-library',
          supports_temporary_key: supportsTemporaryKey
        };
      }

      return {
        ...mod,
        is_allowed: mod.is_allowed && hasAccessByTier,
        requires_api_key: mod.module_key !== 'prompt-library',
        supports_temporary_key: supportsTemporaryKey
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
    const catalog = getChatModelCatalog(userTier);
    res.json({ success: true, ...catalog });
  } catch (error) {
    console.error('Get model catalog error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/:moduleKey/models - Get model catalog for specific module
// This allows UI to show parameters specific to each model/provider
// ──────────────────────────────────────────────
router.get('/:moduleKey/models', authenticateToken, async (req, res) => {
  try {
    const { moduleKey } = req.params;
    const userTier = req.user.subscription_tier || 'trial';
    
    let catalog;
    switch (moduleKey) {
      case 'chatbot':
        catalog = getChatModelCatalog(userTier);
        break;
      case 'message-writer':
        catalog = getMessageModelCatalog(userTier);
        break;
      case 'social-content':
        catalog = getContentModelCatalog(userTier);
        break;
      case 'text-to-speech':
        catalog = getTTSModelCatalog(userTier);
        break;
      case 'text-to-image':
        catalog = getImageModelCatalog(userTier);
        break;
      case 'image-edit':
        catalog = getImageEditModelCatalog(userTier);
        break;
      case 'text-to-video':
        catalog = getVideoModelCatalog(userTier);
        break;
      case 'image-to-video':
        catalog = getImageToVideoModelCatalog(userTier);
        break;
      case 'video-to-video':
        catalog = getVideoToVideoModelCatalog(userTier);
        break;
      case 'text-to-music':
        catalog = getMusicModelCatalog(userTier);
        break;
      case 'voice-clone':
        catalog = getVoiceCloneModelCatalog(userTier);
        break;
      default:
        return res.status(404).json({ 
          success: false, 
          message: `Model catalog not found for module '${moduleKey}'` 
        });
    }
    
    res.json({ success: true, ...catalog });
  } catch (error) {
    console.error('Get module model catalog error:', error);
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
      'text-to-image': ['alibaba', 'pixazo'],
      'image-edit': ['alibaba'],
      'text-to-video': ['alibaba', 'pixazo'],
      'image-to-video': ['pixazo'],
      'video-to-video': ['pixazo'],
      'text-to-speech': ['cloudflare', 'elevenlabs', 'alibaba'],
      'voice-clone': ['alibaba'],
      'text-to-music': ['pixazo'],
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

      // ── Temporary shared key for free-tier text models ──
      // Trial users who haven't added their own NVIDIA key yet can opt in
      // (by sending useTemporaryKey: true) to borrow the app's shared
      // NVIDIA_FREE_TIER_API_KEY instead of being blocked outright. This is
      // only offered for the text-generation modules, only on the free/trial
      // tier, and only when the user has no personal NVIDIA key configured.
      // The existing per-module usage_limit (5 uses/module for trial
      // accounts, set at signup) still applies on top of this, so it
      // naturally caps how many times the shared key can be used before the
      // person is asked to add their own.
      if (TEMPORARY_KEY_MODULES.has(moduleKey) && !apiKeys.nvidia?.api_key) {
        if (req.body.useTemporaryKey) {
          if (userTierLevel > 0) {
            return res.status(403).json({
              success: false,
              message: 'Temporary access is only available on the free/trial tier. Add your own NVIDIA API key in Profile > API Keys.'
            });
          }
          if (!TEMP_NVIDIA_API_KEY) {
            return res.status(503).json({
              success: false,
              message: 'Temporary access isn\'t available right now. Please add your own NVIDIA API key in Profile > API Keys.'
            });
          }
          apiKeys.nvidia = { api_key: TEMP_NVIDIA_API_KEY, temporary: true };
        } else if (userTierLevel === 0 && TEMP_NVIDIA_API_KEY) {
          // Let the frontend offer the "Use temporary key" option instead of
          // just showing a dead-end missing-key error.
          return res.status(400).json({
            success: false,
            message: 'NVIDIA API key not configured. Add your own key in Profile > API Keys, or use a temporary key for a few free messages.',
            missing: ['nvidia'],
            canUseTemporaryKey: true
          });
        }
      }

      // Chatbot resolves its own required provider by tier inside the
      // handler, so it gives a precise "add your X key" error itself
      // instead of a generic missing-key 400 here.
      //
      // For every other module, requiredProviders is a list of ALTERNATIVES
      // (e.g. text-to-speech works with either cloudflare OR elevenlabs), not
      // a list of providers that must ALL be configured. Only block the
      // request if none of the alternatives are available — otherwise a user
      // who has only set up one of them (say, just Cloudflare) gets wrongly
      // rejected for not having the other one too.
      if (moduleKey !== 'chatbot') {
        const hasAnyRequiredProvider = requiredProviders.some(p => apiKeys[p]);
        if (!hasAnyRequiredProvider) {
          return res.status(400).json({
            success: false,
            message: `Missing API keys for: ${requiredProviders.join(' or ')}`,
            missing: requiredProviders
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
      case 'message-writer':
        result = await messageWriterHandler(req.body, apiKeys, userId);
        break;
      case 'social-content':
        result = await contentCreatorHandler(req.body, apiKeys, userId);
        break;
      case 'text-to-speech':
        result = await ttsHandler(req.body, apiKeys, userId, userTier);
        break;
      case 'text-to-image':
        result = await textToImageHandler(req.body, apiKeys, userId);
        break;
      case 'image-edit':
        result = await imageToImageHandler(req.body, apiKeys, userId);
        break;
      case 'text-to-video':
        result = await textToVideoHandler(req.body, apiKeys, userId);
        break;
      case 'image-to-video':
        result = await imageToVideoHandler(req.body, apiKeys, userId);
        break;
      case 'video-to-video':
        result = await videoToVideoHandler(req.body, apiKeys, userId);
        break;
      case 'text-to-music':
        result = await textToMusicHandler(req.body, apiKeys, userId);
        break;
      case 'voice-clone':
        // Same module endpoint handles both steps: default action clones a
        // new voice from a sample; action: 'synthesize' generates speech
        // with an already-cloned voiceId.
        result = req.body.action === 'synthesize'
          ? await voiceSynthesizeHandler(req.body, apiKeys, userId)
          : await voiceCloneHandler(req.body, apiKeys, userId);
        break;
      // Note: 'prompt-library' is a browse/favorite experience, not a
      // generation action, so it doesn't go through this generic execute
      // endpoint — see the dedicated /prompt-library/* routes below.
      default:
        return res.status(501).json({
          success: false,
          message: `Module '${moduleKey}' not implemented yet`
        });
    }

    if (apiKeys.nvidia?.temporary && result && typeof result === 'object') {
      result.usedTemporaryKey = true;
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

// ──────────────────────────────────────────────
// POST /api/modules/image-to-video/status - Check image-to-video status
// ──────────────────────────────────────────────
router.post('/image-to-video/status', authenticateToken, async (req, res) => {
  const { requestId, provider = 'pixazo' } = req.body;
  
  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Request ID is required' });
  }
  
  try {
    // Get user's API keys
    const result = await pool.query(
      `SELECT provider, api_key, workspace_id FROM user_api_keys 
       WHERE user_id = $1 AND provider IN ('pixazo', 'alibaba') AND is_active = true`,
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'API key not configured' });
    }
    
    const apiKeys = {};
    result.rows.forEach(row => {
      apiKeys[row.provider] = { 
        api_key: row.api_key,
        workspace_id: row.workspace_id
      };
    });
    
    const statusResult = await checkI2VStatus(requestId, apiKeys, provider);
    
    res.json({ success: true, ...statusResult });
  } catch (error) {
    console.error('Image-to-video status check error:', error);
    res.status(500).json({ success: false, message: error.message || 'Status check failed' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/video-to-video/status - Check video-to-video status
// ──────────────────────────────────────────────
router.post('/video-to-video/status', authenticateToken, async (req, res) => {
  const { requestId, provider = 'pixazo' } = req.body;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Request ID is required' });
  }

  try {
    const result = await pool.query(
      `SELECT provider, api_key, workspace_id FROM user_api_keys 
       WHERE user_id = $1 AND provider IN ('pixazo', 'alibaba') AND is_active = true`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'API key not configured' });
    }

    const apiKeys = {};
    result.rows.forEach(row => {
      apiKeys[row.provider] = { 
        api_key: row.api_key,
        workspace_id: row.workspace_id
      };
    });
    
    const statusResult = await checkV2VStatus(requestId, apiKeys, provider);

    res.json({ success: true, ...statusResult });
  } catch (error) {
    console.error('Video-to-video status check error:', error);
    res.status(500).json({ success: false, message: error.message || 'Status check failed' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/text-to-video/status - Check text-to-video status
// ──────────────────────────────────────────────
router.post('/text-to-video/status', authenticateToken, async (req, res) => {
  const { requestId, provider = 'pixazo' } = req.body;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Request ID is required' });
  }

  try {
    const result = await pool.query(
      `SELECT provider, api_key, workspace_id FROM user_api_keys 
       WHERE user_id = $1 AND provider IN ('pixazo', 'alibaba') AND is_active = true`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'API key not configured' });
    }

    const apiKeys = {};
    result.rows.forEach(row => {
      apiKeys[row.provider] = { 
        api_key: row.api_key,
        workspace_id: row.workspace_id
      };
    });
    
    const statusResult = await checkT2VStatus(requestId, apiKeys, provider);

    res.json({ success: true, ...statusResult });
  } catch (error) {
    console.error('Text-to-video status check error:', error);
    res.status(500).json({ success: false, message: error.message || 'Status check failed' });
  }
});

// ──────────────────────────────────────────────
// GET /api/modules/voice-clone/voices - List cloned voices for this user
// (Alibaba Cloud only — voice cloning no longer supports ElevenLabs.)
// ──────────────────────────────────────────────
router.get('/voice-clone/voices', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT api_key, workspace_id FROM user_api_keys 
       WHERE user_id = $1 AND provider = 'alibaba' AND is_active = true`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Alibaba Cloud API key not configured'
      });
    }

    const apiKeys = {
      alibaba: {
        api_key: result.rows[0].api_key,
        workspace_id: result.rows[0].workspace_id
      }
    };
    // Voice cloning only supports Alibaba here (see comment above) — the
    // apiKeys object above only ever contains an 'alibaba' entry, but
    // listVoicesHandler defaults its provider param to 'elevenlabs' when
    // none is passed, so every call fell into the ElevenLabs branch and
    // failed with "ElevenLabs API key not configured" even when a valid
    // Alibaba key was on file. Pass the provider explicitly.
    const data = await listVoicesHandler(apiKeys, 'alibaba');

    res.json({ success: true, ...data });
  } catch (error) {
    console.error('List voices error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to list voices' });
  }
});

// ──────────────────────────────────────────────
// POST /api/modules/text-to-music/status - Check text-to-music status
// ──────────────────────────────────────────────
router.post('/text-to-music/status', authenticateToken, async (req, res) => {
  const { requestId } = req.body;
  
  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Request ID is required' });
  }
  
  try {
    // Get user's API keys
    const result = await pool.query(
      `SELECT provider, api_key FROM user_api_keys 
       WHERE user_id = $1 AND provider = 'pixazo' AND is_active = true`,
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Pixazo API key not configured' });
    }
    
    const apiKeys = { pixazo: { api_key: result.rows[0].api_key } };
    const statusResult = await checkAudioStatus(requestId, apiKeys);
    
    res.json({ success: true, ...statusResult });
  } catch (error) {
    console.error('Text-to-music status check error:', error);
    res.status(500).json({ success: false, message: error.message || 'Status check failed' });
  }
});

module.exports = router;
