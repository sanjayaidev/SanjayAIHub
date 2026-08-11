const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const https = require('https');
const AlibabaProvider = require('../providers/alibaba');

// ── POST /api/designer/generate ──
// Handles chat-based image generation using AI models (DeepSeek, etc.)
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { prompt, conversationId, canvasState = null, model = 'deepseek' } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Prompt is required' 
      });
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

    // Check if user has access to the design-studio module.
    // Note: design-studio is NOT one of the modules covered by the shared
    // Pixazo trial (see config/pixazo-trial.js MODULES list), so unlike
    // routes/modules.js there is no trial fallback here — it's Pro-tier
    // gated, full stop. (A previous version of this check queried
    // `pixazo_trial_enabled` / `pixazo_trial_limit` columns on `users` that
    // were never part of the schema — those only ever existed as constants
    // in config/pixazo-trial.js — so that fallback always threw instead of
    // working. Removed rather than "fixed" since design-studio was never
    // meant to be trial-accessible in the first place.)
    const tierLevels = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
    const userTier = req.user.subscription_tier || 'trial';
    const userTierLevel = tierLevels[userTier] || 0;
    const requiredTierLevel = tierLevels['pro'] || 2;

    if (userTierLevel < requiredTierLevel) {
      return res.status(403).json({
        success: false,
        message: 'Design Studio requires Pro tier or higher'
      });
    }

    // Build the system prompt for design generation
    const SYSTEM_PROMPT = buildSystemPrompt(canvasState);
    
    // Build conversation history if available
    let conversationHistory = [];
    if (conversationId) {
      const historyResult = await pool.query(
        `SELECT role, content FROM designer_conversation
         WHERE user_id = $1 AND conversation_id = $2
         ORDER BY created_at ASC
         LIMIT 10`,
        [req.user.id, conversationId]
      );
      conversationHistory = historyResult.rows;
    }

    // Construct the full prompt
    const historyText = conversationHistory.length
      ? conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      : '(first message in this conversation)';
    
    const stateText = canvasState ? JSON.stringify(canvasState, null, 2) : '{}';
    
    const fullPrompt = SYSTEM_PROMPT
      .replace('{{CANVAS_STATE}}', stateText)
      .replace('{{HISTORY}}', historyText)
      .replace('{{USER_MESSAGE}}', prompt);

    // Call the AI model API
    let aiResponse;
    if (model === 'nvidia') {
      aiResponse = await callNvidiaAPI(fullPrompt, apiKeys.nvidia?.api_key);
    } else {
      // 'deepseek' (default) — and any other value — now runs through Alibaba
      // Cloud Model Studio (DashScope), which hosts DeepSeek models
      // (deepseek-v3.2, deepseek-v4-flash, deepseek-v4-pro) behind its
      // OpenAI-compatible endpoint. This app has no standalone DeepSeek API
      // key setup, only Alibaba (api_key + workspace_id) — see Profile > API Keys.
      const deepseekModel = (model && model !== 'deepseek') ? model : 'deepseek-v3.2';
      aiResponse = await callAlibabaDeepSeekAPI(
        fullPrompt,
        apiKeys.alibaba?.api_key,
        apiKeys.alibaba?.workspace_id,
        deepseekModel
      );
    }

    // Save conversation to database
    if (conversationId) {
      await pool.query(
        `INSERT INTO designer_conversation (user_id, conversation_id, role, content)
         VALUES ($1, $2, 'user', $3)`,
        [req.user.id, conversationId, prompt]
      );
      
      await pool.query(
        `INSERT INTO designer_conversation (user_id, conversation_id, role, content)
         VALUES ($1, $2, 'assistant', $3)`,
        [req.user.id, conversationId, aiResponse]
      );
    }

    // Extract JSON from response
    const designSpec = extractJSON(aiResponse);
    
    if (!designSpec) {
      // Surface the raw model output straight to the UI (see
      // public/js/designer-agent.js handleSend / callDesignBackend) instead
      // of only logging it server-side — the browser is a much easier place
      // to inspect the exact text than server logs, which can interleave or
      // reorder large multi-line writes from concurrent requests.
      return res.status(500).json({
        success: false,
        message: 'Failed to generate valid design specification',
        rawResponse: aiResponse
      });
    }

    res.json({
      success: true,
      spec: designSpec,
      conversationId: conversationId || `conv_${Date.now()}`,
      rawResponse: aiResponse
    });

  } catch (error) {
    console.error('Designer generate error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate design'
    });
  }
});

// ── GET /api/designer/conversations ──
// Get all conversations for current user
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT conversation_id, MAX(created_at) as last_updated
       FROM designer_conversation
       WHERE user_id = $1
       GROUP BY conversation_id
       ORDER BY last_updated DESC
       LIMIT 50`,
      [req.user.id]
    );
    
    res.json({ 
      success: true, 
      conversations: result.rows 
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch conversations' 
    });
  }
});

// ── DELETE /api/designer/conversations/:conversationId ──
// Delete a conversation
router.delete('/conversations/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    await pool.query(
      `DELETE FROM designer_conversation
       WHERE user_id = $1 AND conversation_id = $2`,
      [req.user.id, conversationId]
    );
    
    res.json({
      success: true,
      message: 'Conversation deleted'
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete conversation'
    });
  }
});

// ── Helper Functions ──

function buildSystemPrompt(canvasState) {
  return `You are DESIGN AGENT — a professional design executor that creates complete, production-ready Instagram/social media designs. Output ONLY a valid JSON design spec. No markdown, no commentary, no code fences.

═══════════════════════════════════════════════════════════════
ABSOLUTE RULES (NON-NEGOTIABLE):
═══════════════════════════════════════════════════════════════
Output ONLY a single valid JSON object — nothing else.
Spec must be COMPLETE and immediately applicable to canvas.
Preserve ALL elements user didn't ask to change (check CANVAS STATE).
Text blocks MUST include: x (0-100% horizontal position), y (0-100% vertical position), rot (degrees), align (left|center|right).
Use ONLY these fonts: DM Sans, Space Mono, Bebas Neue, Playfair Display, Oswald, Montserrat, Raleway, Syne.
CREATIVE FREEDOM: Use your designer's eye — add imgBg, mainImg, icons, logos, text bg fills to maximize visual impact as you think will be right for the image.
CONTENT MUST FIT: All elements must stay within canvas bounds with proper spacing.
MINIMUM REQUIREMENTS:
Background: If using imgBg make sure to always use imgBg with a verified Unsplash URL (opacity 20-40, overlay 65-80). A solid/plain background is NOT acceptable — always layer an image behind the gradient.
Icons: include 3-5 icons using icons8 URLs. Use generic icons if topic-specific ones are uncertain must not overalp with text
Brand: Always include brand signature at bottom
Text blocks: Use appropriate hierarchy (headline → subtitle → body/bullets)if the texts are realted keep verital Y gap to MINIMUM

🚨 CRITICAL OUTPUT RULE: You MUST output EXACTLY ONE valid JSON object representing a SINGLE design spec.
DO NOT output an array of designs. DO NOT generate multiple days.
The output must be a single { ... } object matching the COMPLETE JSON SCHEMA below.

═══════════════════════════════════════════════════════════════
RESOURCE SOURCES (APPROVED):
═══════════════════════════════════════════════════════════════
ICONS (use icons8 PNG URLs — these are CORS-safe and render reliably):
Format: https://img.icons8.com/fluency/96/[name].png

BACKGROUNDS — copy the FULL URL exactly as written:
Technology/AI:
  https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1080&auto=format&fit=crop

Business/Marketing:
  https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=1080&auto=format&fit=crop

Social Media/Content:
  https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=1080&auto=format&fit=crop

ALWAYS pair imgBg with overlay ≥65 so text remains readable.

═══════════════════════════════════════════════════════════════
COMPLETE JSON SCHEMA:
═══════════════════════════════════════════════════════════════
{
  "canvasW": 1080,
  "canvasH": 1350,
  "bg": { "type": "solid|linear|radial", "color": "#hex", ... },
  "imgBg": { "src": "url|none", "url": "https://images.unsplash.com/...", "opacity": 30, "overlay": 70 },
  "mainImg": { "src": "url|none", "url": "...", "w": 80, "h": 70, "x": 50, "y": 50, "rot": 0, "opacity": 100 },
  "icons": [{ "src": "https://img.icons8.com/fluency/96/name.png", "x": 50, "y": 15, "size": 120, "rot": 0, "opacity": 90 }],
  "brands": [{ "text": "@YOURBRAND", "x": 50, "y": 94, "size": 22, "color": "#4DFFA0", "font": "Space Mono" }],
  "textBlocks": [{ "type": "headline|title|subtitle|body|bullet", "text": "...", "x": 50, "y": 30, "rot": 0, "size": 96, "font": "Bebas Neue", "align": "center" }],
  "logo": { "src": "url|none", "url": "...", "w": 150, "anchor": "bl" }
}

CANVAS STATE (preserve what user didn't change):
{{CANVAS_STATE}}

CONVERSATION HISTORY:
{{HISTORY}}

USER REQUEST:
{{USER_MESSAGE}}

Output ONLY the complete JSON design spec now.`;
}

// DeepSeek via Alibaba Cloud Model Studio (DashScope), using the same
// OpenAI-compatible chat-completions wrapper as modules/chatbot.js and
// modules/text-to-image.js (providers/alibaba.js). Requires the user to have
// saved an Alibaba API key + Workspace ID under Profile > API Keys — there is
// no separate "deepseek" provider/key in this app.
async function callAlibabaDeepSeekAPI(prompt, apiKey, workspaceId, model = 'deepseek-v3.2') {
  if (!apiKey || !workspaceId) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }

  const alibaba = new AlibabaProvider(apiKey, workspaceId);

  let data;
  try {
    data = await alibaba.chatCompletion(
      [
        { role: 'system', content: 'You are a professional design assistant. Output ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      {
        model,
        temperature: 0.7,
        max_tokens: 4000,
        // deepseek-v3.2+ is a hybrid reasoning model that thinks by default.
        // We need the raw JSON spec, not a reasoning trace, and the two
        // share the same max_tokens budget — without this, DeepSeek can
        // spend the entire budget "thinking" and return an empty or
        // truncated message.content, which then fails JSON extraction
        // below with a generic "Failed to generate valid design
        // specification" error. See providers/alibaba.js chatCompletion().
        enable_thinking: false,
      }
    );
  } catch (err) {
    throw new Error(`Alibaba API error: ${err.message}`);
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error('Invalid response from Alibaba API');
  }
  return reply;
}

async function callNvidiaAPI(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('NVIDIA API key not configured'));
      return;
    }

    const postData = JSON.stringify({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [
        { role: 'system', content: 'You are a professional design assistant. Output ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const options = {
      hostname: 'integrate.api.nvidia.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0]) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('Invalid response from NVIDIA API'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse NVIDIA response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`NVIDIA API request failed: ${e.message}`)));
    req.write(postData);
    req.end();
  });
}

function extractJSON(s) {
  if (!s) return null;
  
  // Remove markdown code fences
  let cleaned = s.replace(/```json\s*([\s\S]*?)```/gi, '$1')
                 .replace(/```\s*([\s\S]*?)```/gi, '$1')
                 .trim();
  
  // Find the JSON object
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  
  let depth = 0, inStr = false, escape = false, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) { escape = false; continue; }
    
    if (c === '\\') { 
      if (inStr) escape = true; 
      continue; 
    }
    
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  
  let candidate = end !== -1 ? cleaned.slice(start, end + 1) : cleaned.slice(start);
  
  try { return JSON.parse(candidate); } catch (e) {}
  
  // Try to repair common JSON issues
  candidate = candidate.replace(/,\s*([]}])/g, '$1'); // Remove trailing commas
  candidate = candidate.replace(/'([^']*)'\s*:/g, '"$1":'); // Fix single quotes
  // Strip stray backslashes before [ or ]. Some models (esp. reasoning
  // models) over-eagerly markdown-escape square brackets — e.g. emitting
  // "opacity": \[35\] instead of "opacity": 35 — likely defensive against
  // the bracket being read as markdown reference-link syntax elsewhere in
  // the pipeline. \[ and \] are never legal JSON escapes (only
  // \" \\ \/ \b \f \n \r \t \uXXXX are), so unescaping them is always safe,
  // never destructive to genuinely valid JSON.
  candidate = candidate.replace(/\\([[\]])/g, '$1');
  // Add the leading 0 to bare decimals like ": .80" or "[-.5". JavaScript
  // allows a number to start with just ".", but JSON does not — DeepSeek
  // sometimes emits values this way (e.g. "overlay": .80 instead of 0.80),
  // which JSON.parse rejects outright ("Unexpected token '.'").
  candidate = candidate.replace(/([:[,]\s*)(-?)\.(\d)/g, '$1$20.$3');

  try { return JSON.parse(candidate); } catch (e) {}
  
  return null;
}

module.exports = router;