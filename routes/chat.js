const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { chatbotHandler, getModelCatalog } = require('../modules/chatbot');

// ── GET all threads for current user ──
router.get('/threads', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, model, is_active, created_at, updated_at
       FROM chat_threads
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, threads: result.rows });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch threads' });
  }
});

// ── GET messages for a thread ──
router.get('/threads/:threadId/messages', authenticateToken, async (req, res) => {
  try {
    const { threadId } = req.params;

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
    res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

// ── RENAME thread ──
router.put('/threads/:threadId', authenticateToken, async (req, res) => {
  try {
    const { threadId } = req.params;
    const { title } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const threadCheck = await pool.query(
      'SELECT id FROM chat_threads WHERE id = $1 AND user_id = $2',
      [threadId, req.user.id]
    );
    if (threadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    const result = await pool.query(
      `UPDATE chat_threads
       SET title = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, updated_at`,
      [title.trim(), threadId]
    );

    res.json({
      success: true,
      thread: result.rows[0],
      message: 'Thread renamed successfully'
    });
  } catch (error) {
    console.error('Rename thread error:', error);
    res.status(500).json({ success: false, message: 'Failed to rename thread' });
  }
});

// ── DELETE thread (HARD delete) ──
router.delete('/threads/:threadId', authenticateToken, async (req, res) => {
  try {
    const { threadId } = req.params;

    const threadCheck = await pool.query(
      'SELECT id FROM chat_threads WHERE id = $1 AND user_id = $2',
      [threadId, req.user.id]
    );
    if (threadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    // HARD DELETE - removes thread + all messages (ON DELETE CASCADE)
    await pool.query(
      `DELETE FROM chat_threads WHERE id = $1`,
      [threadId]
    );

    res.json({
      success: true,
      message: 'Thread permanently deleted'
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete thread' });
  }
});

// ── POST new message ──
router.post('/chatbot', authenticateToken, async (req, res) => {
  try {
    const { messages, model, temperature, max_tokens, threadId, title, imageDataUrl } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'Messages array is required' });
    }

    // Get user's API keys
    const keysResult = await pool.query(
      `SELECT provider, api_key, workspace_id, account_id
       FROM user_api_keys
       WHERE user_id = $1 AND is_active = true`,
      [req.user.id]
    );

    const apiKeys = {};
    for (const row of keysResult.rows) {
      apiKeys[row.provider] = {
        api_key: row.api_key,
        workspace_id: row.workspace_id,
        account_id: row.account_id,
      };
    }

    const result = await chatbotHandler(
      { messages, model, temperature, max_tokens, threadId, title, imageDataUrl },
      apiKeys,
      req.user.id,
      req.user.subscription_tier || 'trial'
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process chat request'
    });
  }
});

// ── GET available models (tier-aware, shows both providers for paid) ──
router.get('/chatbot/models', authenticateToken, async (req, res) => {
  try {
    const userTier = req.user.subscription_tier || 'trial';
    const catalog = getModelCatalog(userTier);

    // Check which provider keys are configured
    const keysResult = await pool.query(
      `SELECT provider, is_active
       FROM user_api_keys
       WHERE user_id = $1 AND is_active = true`,
      [req.user.id]
    );

    const configuredProviders = keysResult.rows.map(r => r.provider);
    const hasNvidiaKey = configuredProviders.includes('nvidia');
    const hasAlibabaKey = configuredProviders.includes('alibaba');

    res.json({
      success: true,
      ...catalog,
      configuredProviders,
      hasNvidiaKey,
      hasAlibabaKey,
      // Tell frontend which models need which keys
      modelRequirements: {
        nvidia: { provider: 'nvidia', requires: ['api_key'], keyConfigured: hasNvidiaKey },
        alibaba: { provider: 'alibaba', requires: ['api_key', 'workspace_id'], keyConfigured: hasAlibabaKey }
      }
    });
  } catch (error) {
    console.error('Models catalog error:', error);
    res.status(500).json({ success: false, message: 'Failed to load models' });
  }
});

module.exports = router;