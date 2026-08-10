const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const NvidiaProvider = require('../providers/nvidia');
const { getChatModels } = require('../providers/alibaba-models');

// ── NVIDIA ──────────────────────────────────────────────
const NVIDIA_TEXT_MODELS = [
  // Meta models - Text only
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-3b-instruct',

  // NVIDIA text models (excluding safety/content moderation)
  // Removed 2026-08-10: mistralai/mistral-medium-3.5-128b (410 Gone,
  // EOL 2026-08-07) and nvidia/ising-calibration-1-35b-a3b (410 Gone,
  // EOL 2026-07-27) — both confirmed dead via scripts/test-endpoints.js.
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
];

// NVIDIA Vision models (separate for vision detection)
const NVIDIA_VISION_MODELS = [
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  'nvidia/nemotron-nano-12b-v2-vl',
];

// All NVIDIA models combined
const NVIDIA_ALL_MODELS = [...NVIDIA_TEXT_MODELS, ...NVIDIA_VISION_MODELS];
const NVIDIA_DEFAULT_MODEL = 'meta/llama-3.1-70b-instruct';

// Models with excellent multilingual/regional language support
const MULTILINGUAL_MODELS = new Set([
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  // mistralai/mistral-medium-3.5-128b removed 2026-08-10 (410 Gone, EOL 2026-08-07)
]);

// ── ALIBABA ──────────────────────────────────────────────
// Full model catalog (llm + multimodal, ~90 chat-capable models), pulled
// from providers/alibaba-models.js and split into text-only vs
// vision/audio-capable (based on which models accept file uploads).
const { text: ALIBABA_TEXT_MODELS, vision: ALIBABA_VISION_MODELS } = getChatModels();
const ALIBABA_DEFAULT_MODEL = 'qwen3.5-plus';

const PAID_TIERS = new Set(['basic', 'pro', 'enterprise']);

// ── Catalog helper ──
function getModelCatalog(userTier) {
  const isPaid = PAID_TIERS.has(userTier);
  
  // Start with NVIDIA models (always available if key is configured)
  let textModels = [...NVIDIA_TEXT_MODELS];
  let visionModels = [...NVIDIA_VISION_MODELS];
  
  // Add Alibaba models for paid users
  if (isPaid) {
    textModels = [...textModels, ...ALIBABA_TEXT_MODELS];
    visionModels = [...visionModels, ...ALIBABA_VISION_MODELS];
  }
  
  return {
    provider: isPaid ? 'alibaba' : 'nvidia', // Default provider for new chats
    tier: userTier || 'trial',
    text: textModels,
    vision: visionModels,
    default: isPaid ? ALIBABA_DEFAULT_MODEL : NVIDIA_DEFAULT_MODEL,
    // Track which models belong to which provider for display
    modelProviders: {
      nvidia: NVIDIA_ALL_MODELS,           // All NVIDIA models for reference
      nvidiaText: NVIDIA_TEXT_MODELS,      // For grouping in UI
      nvidiaVision: NVIDIA_VISION_MODELS,  // For grouping in UI + vision detection
      alibaba: isPaid ? ALIBABA_TEXT_MODELS : [],
      alibabaVision: isPaid ? ALIBABA_VISION_MODELS : []
    },
    // Track multilingual models
    multilingual: Array.from(MULTILINGUAL_MODELS)
  };
}

// ── Resolve model with provider detection (FIXED) ──
function resolveModel(userTier, requestedModel, userApiKeys = {}) {
  const catalog = getModelCatalog(userTier);
  const allModels = [...catalog.text, ...catalog.vision];
  
  if (requestedModel && allModels.includes(requestedModel)) {
    // Determine which provider this model belongs to
    let provider = 'nvidia'; // Default to NVIDIA
    let isVision = false;
    
    // Check if it's an Alibaba model (paid tier models)
    if (catalog.modelProviders.alibaba.includes(requestedModel) || 
        catalog.modelProviders.alibabaVision.includes(requestedModel)) {
      provider = 'alibaba';
      isVision = catalog.modelProviders.alibabaVision.includes(requestedModel);
    } 
    // Check if it's an NVIDIA vision model
    else if (catalog.modelProviders.nvidiaVision.includes(requestedModel)) {
      provider = 'nvidia';
      isVision = true;
    }
    // Everything else is NVIDIA text (including Mistral, Meta text models, etc.)
    else {
      provider = 'nvidia';
      isVision = false;
    }
    
    // Check if the required key exists
    let hasKey = false;
    if (provider === 'nvidia') {
      hasKey = !!userApiKeys?.nvidia?.api_key;
    } else {
      hasKey = !!(userApiKeys?.alibaba?.api_key && userApiKeys?.alibaba?.workspace_id);
    }
    
    return {
      provider,
      model: requestedModel,
      isVision,
      hasKey,
      isMultilingual: MULTILINGUAL_MODELS.has(requestedModel)
    };
  }
  
  // Fallback to default
  const defaultProvider = catalog.provider;
  let hasKey = false;
  if (defaultProvider === 'nvidia') {
    hasKey = !!userApiKeys?.nvidia?.api_key;
  } else {
    hasKey = !!(userApiKeys?.alibaba?.api_key && userApiKeys?.alibaba?.workspace_id);
  }
  
  return {
    provider: defaultProvider,
    model: catalog.default,
    isVision: false,
    hasKey,
    isMultilingual: MULTILINGUAL_MODELS.has(catalog.default)
  };
}

// ── Main handler ──
async function chatbotHandler(requestBody, apiKeys, userId, userTier) {
  const {
    messages,
    model: requestedModel,
    temperature = 0.7,
    max_tokens = 2048,
    threadId = null,
    title = null,
    imageDataUrl = null,
  } = requestBody;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required');
  }

  // Resolve which provider and model to use
  const { provider, model, isVision, hasKey } = resolveModel(userTier, requestedModel, apiKeys);

  if (!hasKey) {
    const providerName = provider === 'nvidia' ? 'NVIDIA' : 'Alibaba Cloud';
    throw new Error(`${providerName} API key not configured. Add it in Profile > API Keys.`);
  }

  if (imageDataUrl && !isVision) {
    throw new Error(`Model "${model}" does not support image input. Pick a vision model.`);
  }

  // Build upstream messages
  let upstreamMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  if (isVision && imageDataUrl) {
    let lastUserIdx = -1;
    for (let i = upstreamMessages.length - 1; i >= 0; i--) {
      if (upstreamMessages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const textPart = upstreamMessages[lastUserIdx].content || 'What is in this image?';
      upstreamMessages[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'text', text: textPart },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      };
    }
  }

  // ── Thread persistence ──
  let resolvedThreadId = threadId;
  if (userId) {
    try {
      // Never trust a client-supplied threadId blindly: it may be stale
      // (thread deleted since the page loaded), belong to another user,
      // or reference a row that never existed (e.g. after a DB reset).
      // Using it as-is would violate chat_messages_thread_id_fkey.
      if (resolvedThreadId) {
        const existing = await pool.query(
          `SELECT id FROM chat_threads WHERE id = $1 AND user_id = $2`,
          [resolvedThreadId, userId]
        );
        if (existing.rows.length === 0) {
          resolvedThreadId = null;
        }
      }

      if (!resolvedThreadId) {
        const threadResult = await pool.query(
          `INSERT INTO chat_threads (user_id, title, model)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [userId, title || 'New Conversation', model]
        );
        resolvedThreadId = threadResult.rows[0].id;
      }

      const userMessages = messages.filter((m) => m.role === 'user');
      for (const msg of userMessages) {
        const attachments = imageDataUrl && msg === userMessages[userMessages.length - 1]
          ? JSON.stringify([{ type: 'image', included: true }])
          : '[]';
        await pool.query(
          `INSERT INTO chat_messages (thread_id, role, content, attachments, model_used)
           VALUES ($1, $2, $3, $4, $5)`,
          [resolvedThreadId, msg.role, msg.content, attachments, model]
        );
      }

      if (!title && resolvedThreadId) {
        const firstMsg = userMessages[0]?.content;
        if (firstMsg) {
          const shortTitle = firstMsg.slice(0, 50).trim() + (firstMsg.length > 50 ? '...' : '');
          await pool.query(
            `UPDATE chat_threads SET title = $1 WHERE id = $2 AND title = 'New Conversation'`,
            [shortTitle, resolvedThreadId]
          );
        }
      }
    } catch (err) {
      console.error('Chatbot thread persistence error:', err);
    }
  }

  // ── Call the upstream provider ──
  let reply = '';
  let usage = null;

  if (provider === 'nvidia') {
    const nvidiaKey = apiKeys.nvidia?.api_key;
    if (!nvidiaKey) {
      throw new Error('NVIDIA API key not configured. Add it in Profile > API Keys.');
    }

    const nvidia = new NvidiaProvider(nvidiaKey);
    try {
      const data = await nvidia.chatCompletion(upstreamMessages, { model, temperature, max_tokens });
      reply = data.choices?.[0]?.message?.content || '';
      usage = data.usage;
    } catch (err) {
      throw new Error(`NVIDIA API error: ${err.message}`);
    }

  } else {
    const alibabaKeys = apiKeys.alibaba;
    if (!alibabaKeys?.api_key || !alibabaKeys?.workspace_id) {
      throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
    }

    const alibaba = new AlibabaProvider(alibabaKeys.api_key, alibabaKeys.workspace_id);
    try {
      const data = await alibaba.chatCompletion(upstreamMessages, { model, temperature, max_tokens });
      reply = data.choices?.[0]?.message?.content || '';
      usage = data.usage;
    } catch (err) {
      throw new Error(`Alibaba API error: ${err.message}`);
    }
  }

  // ── Save assistant response ──
  if (userId && resolvedThreadId && reply) {
    try {
      await pool.query(
        `INSERT INTO chat_messages (thread_id, role, content, model_used, token_count)
         VALUES ($1, 'assistant', $2, $3, $4)`,
        [resolvedThreadId, reply, model, usage?.total_tokens || 0]
      );
    } catch (err) {
      console.error('Failed to save assistant message:', err);
    }
  }

  return {
    threadId: resolvedThreadId,
    message: reply,
    usage,
    model,
    provider,
  };
}

module.exports = { 
  chatbotHandler, 
  getModelCatalog, 
  resolveModel, 
  MULTILINGUAL_MODELS,
  // Export for testing/debugging
  NVIDIA_TEXT_MODELS,
  NVIDIA_VISION_MODELS,
  ALIBABA_TEXT_MODELS,
  ALIBABA_VISION_MODELS
};