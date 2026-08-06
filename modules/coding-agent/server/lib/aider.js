// lib/aider.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getModelById, WORKING_MODELS } from './models.js';
import { suggestFiles, sanitizeRelFiles } from './fileContext.js';
// NOTE: coding-agent shares SanjayAIHub's Postgres DB so users only have
// to configure their Alibaba key once (Profile > API Keys) instead of
// duplicating it here. This reaches up out of modules/coding-agent into
// the main app's db/index.js — path was previously wrong (pointed at a
// nonexistent modules/coding-agent/db/index.js), a leftover from when
// this was split out of another project.
import pool from '../../../../db/index.js';

const execFileAsync = promisify(execFile);

// Get Alibaba credentials for a specific user from the database
async function getUserAlibabaCredentials(userId) {
  const result = await pool.query(
    `SELECT api_key, workspace_id FROM user_api_keys 
     WHERE user_id = $1 AND provider = 'alibaba' AND is_active = true`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('No Alibaba credentials found for this user. Please add your API key in Profile > API Keys.');
  }
  
  return {
    apiKey: result.rows[0].api_key,
    workspaceId: result.rows[0].workspace_id
  };
}

export async function runAider({
  workDir,
  modelId,
  task,
  files = [],
  options = {},
  userId, // Required: the user's ID to fetch their credentials
}) {
  // Validate user ID is provided
  if (!userId) {
    throw new Error('userId is required to fetch per-user Alibaba credentials');
  }
  
  // Fetch user-specific Alibaba credentials from database
  const { apiKey, workspaceId } = await getUserAlibabaCredentials(userId);
  
  // Build Alibaba base URL from user's workspace ID
  const ALIBABA_BASE = `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`;

  // Validate model
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}. Choose from ${WORKING_MODELS.map(m => m.id).join(', ')}`);
  }

  if (!fs.existsSync(workDir)) {
    throw new Error(`workDir does not exist: ${workDir}. Clone the repo first via POST /api/repos/clone.`);
  }

  // Resolve which files aider gets as explicit context. Two paths:
  //   - caller passed files (manually attached in the UI, or picked by an
  //     LLM/automation calling POST /api/agent/suggest-files first) — just
  //     sanitize them against path traversal.
  //   - caller passed nothing — fall back to a heuristic scan of the repo
  //     scored against the task text, so aider isn't relying purely on its
  //     own repo-map guess for tasks that don't name a file explicitly.
  // Either way the resolved list comes back on the result so the caller
  // can show the user what aider actually got.
  let resolvedFiles;
  let filesSource;
  if (files && files.length > 0) {
    const { files: clean, rejected } = sanitizeRelFiles(workDir, files);
    if (rejected.length > 0) {
      console.warn('[Aider] Rejected out-of-repo file paths:', rejected);
    }
    resolvedFiles = clean;
    filesSource = 'manual';
  } else {
    resolvedFiles = suggestFiles({ workDir, task, limit: 8 }).map(f => f.path);
    filesSource = 'auto';
  }

  console.log(`[Aider] Files (${filesSource}):`, resolvedFiles.length ? resolvedFiles.join(', ') : '(none — aider will rely on its own repo map)');

  // Aider uses litellm under the hood. To route a custom OPENAI_API_BASE
  // (Alibaba's DashScope compatible-mode endpoint) instead of matching
  // some other provider's preset by name, the model must be passed with
  // an "openai/" prefix — litellm strips that prefix and sends the rest
  // as the `model` field in the request body to OPENAI_API_BASE.
  const litellmModel = modelId.startsWith('openai/') ? modelId : `openai/${modelId}`;

  const aiderEnv = {
    ...process.env,
    OPENAI_API_BASE: ALIBABA_BASE,
    OPENAI_API_KEY: apiKey,
  };

  const aiderArgs = [
    // Explicit files to include in context (manually attached, or
    // auto-suggested above when the caller didn't attach any)
    ...resolvedFiles,
    // Non-interactive mode
    '--yes-always',
    // Skip updates
    '--no-check-update',
    // Don't touch .gitignore
    '--no-gitignore',
    // Leave changes in the working tree uncommitted — the UI shows them as
    // a diff and the user explicitly applies (commits) or discards them.
    '--no-auto-commits',
    // Model
    '--model', litellmModel,
    // The task
    '--message', task,
    // Keep history outside repo
    '--chat-history-file', path.join(workDir, '..', '.aider-chat.md'),
    '--input-history-file', path.join(workDir, '..', '.aider-input.md'),
    // Code formatting
    '--code-theme', 'dracula',
  ];

  console.log(`[Aider] Running with model: ${modelId}`);
  console.log(`[Aider] Task: ${task.slice(0, 100)}...`);

  try {
    const { stdout, stderr } = await execFileAsync('aider', aiderArgs, {
      cwd: workDir,
      env: aiderEnv,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    return { stdout, stderr, success: true, filesUsed: resolvedFiles, filesSource };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        "The 'aider' command was not found on this machine/container. " +
        "aider is a Python CLI (not an npm package), so it isn't installed " +
        "by `npm install`. Install it with: pip install aider-install && aider-install " +
        "— then make sure the directory it installs to (usually ~/.local/bin) is on PATH " +
        "for the process running this server."
      );
    }
    // Aider can exit non-zero even after making changes
    console.log(`[Aider] Exit code: ${error.code}`);
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      success: false,
      error: error.message,
      filesUsed: resolvedFiles,
      filesSource,
    };
  }
}