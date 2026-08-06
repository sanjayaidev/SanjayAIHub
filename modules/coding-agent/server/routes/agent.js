// routes/agent.js
import express from 'express';
import { runAider } from '../lib/aider.js';
import { WORKING_MODELS, getModelById, getRecommendedModel } from '../lib/models.js';
import { getDiff } from '../lib/git.js';
import { suggestFiles } from '../lib/fileContext.js';
import fs from 'fs';

const router = express.Router();

// Get all available models
router.get('/models', (req, res) => {
  res.json({
    models: WORKING_MODELS,
    total: WORKING_MODELS.length,
  });
});

// Helper for the caller (UI, or an LLM/automation driving this API
// directly) to see which files aider would pick for a task BEFORE
// running it, and to fine-tune the list before submitting it as `files`
// on /run. Read-only — doesn't touch aider or the repo, just scores the
// existing files against the task text.
router.post('/suggest-files', (req, res) => {
  const { repoPath, task, limit } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }
  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'repoPath does not exist. Load the repo first.' });
  }
  if (!task || !task.trim()) {
    return res.status(400).json({ error: 'task is required' });
  }

  try {
    const suggestions = suggestFiles({ workDir: repoPath, task, limit: limit || 8 });
    res.json({ suggestions, total: suggestions.length });
  } catch (error) {
    console.error('[Agent] suggest-files failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run the agent
router.post('/run', async (req, res) => {
  const { repoPath, task, modelId, files = [] } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'repoPath is required' });
  }
  if (!task) {
    return res.status(400).json({ error: 'task is required' });
  }

  // Get user ID from session. This must be mainUserId (the main-app
  // user's UUID, used to look up their Alibaba credentials in
  // user_api_keys) — req.session.user is the GitHub profile set by the
  // OAuth flow (login/name/avatarUrl/email) and never had an `.id` field
  // matching that table, so this previously 401'd on every single
  // request regardless of whether GitHub was connected.
  if (!req.session.mainUserId) {
    return res.status(401).json({ error: 'Authentication required. Please log in first.' });
  }
  const userId = req.session.mainUserId;

  // If no model specified, use recommended
  let model = modelId;
  if (!model) {
    const recommended = getRecommendedModel(task);
    model = recommended.id;
  }

  // Validate model exists
  if (!getModelById(model)) {
    return res.status(400).json({
      error: `Model "${model}" not found. Available: ${WORKING_MODELS.map(m => m.id).join(', ')}`,
    });
  }

  try {
    const result = await runAider({
      workDir: repoPath,
      modelId: model,
      task,
      files,
      userId, // Pass user ID for per-user credentials
    });

    let diff = { diff: '', files: [] };
    try {
      diff = await getDiff(repoPath);
    } catch (diffError) {
      console.error('[Agent] Diff read failed:', diffError);
    }

    res.json({
      success: result.success,
      model,
      output: result.stdout,
      error: result.stderr || result.error,
      diff: diff.diff,
      changedFiles: diff.files,
      filesUsed: result.filesUsed || [],
      filesSource: result.filesSource || 'manual',
    });
  } catch (error) {
    console.error('[Agent] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stream version for real-time updates
router.post('/run/stream', async (req, res) => {
  const { repoPath, task, modelId, files = [] } = req.body;

  if (!repoPath || !task) {
    return res.status(400).json({ error: 'repoPath and task are required' });
  }

  // Same fix as /run above — mainUserId, not session.user.id.
  if (!req.session.mainUserId) {
    return res.status(401).json({ error: 'Authentication required. Please log in first.' });
  }
  const userId = req.session.mainUserId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'start', message: 'Starting aider...' });

  try {
    const result = await runAider({
      workDir: repoPath,
      modelId: modelId || getRecommendedModel(task).id,
      task,
      files,
      userId, // Pass user ID for per-user credentials
    });

    if (result.success) {
      send({ type: 'done', ...result });
    } else {
      send({ type: 'error', error: result.error });
    }
  } catch (error) {
    send({ type: 'error', error: error.message });
  }

  res.end();
});

export default router;