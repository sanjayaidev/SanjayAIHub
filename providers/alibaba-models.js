// providers/alibaba-models.js
// Full Alibaba Cloud Model Studio (DashScope) model catalog, ported from
// https://github.com/sanjayaidev/AlibabaCloud (models.js), verified working
// models in the Singapore region. ~140 models across all categories.
// Kept in CommonJS to match the rest of SanjayAIHub's provider layer.
//
// Source snapshot last updated: 2026-06-23

const MODELS = {
  // ── LLM Models (82 working) ──────────────────────────────────────────────
  llm: [
    'qwen3.5-122b-a10b',
    'qwen3.7-plus',
    'qwen3-vl-235b-a22b-thinking',
    'qwen-plus-2025-07-28',
    'qwen3-max',
    'qwen3.5-plus-2026-02-15',
    'qwen-max',
    'qwen-mt-flash',
    'qwen3-vl-30b-a3b-thinking',
    'qwen3-235b-a22b-thinking-2507',
    'qwen3.7-max-2026-06-08',
    'glm-5.1',
    'qwen3.7-max-preview',
    'qwen3.6-plus',
    'qwen3.6-max-preview',
    'qwen3-32b',
    'qwen3.5-397b-a17b',
    'qwen3-vl-plus-2025-09-23',
    'qwen3.6-flash',
    'qwen-vl-plus',
    'deepseek-v3.2',
    'qwen3-coder-next',
    'qwen3.5-flash',
    'qwen3.5-35b-a3b',
    'deepseek-v4-flash',
    'qwen3-30b-a3b-thinking-2507',
    'qwen3-coder-plus-2025-09-23',
    'qwen-plus-latest',
    'qwen3-coder-480b-a35b-instruct',
    'qwen3-max-2026-01-23',
    'qwen3-vl-8b-thinking',
    'qwen3-coder-plus',
    'qwen-plus-2025-09-11',
    'qwen3-vl-flash-2026-01-22',
    'qwen3-max-preview',
    'qwen3.5-flash-2026-02-23',
    'qwen3-vl-flash-2025-10-15',
    'qwen-vl-max',
    'qwen3.7-max-2026-05-20',
    'qwen3-vl-30b-a3b-instruct',
    'qwen3.7-plus-2026-05-26',
    'qwen3-coder-30b-a3b-instruct',
    'qwen3-vl-235b-a22b-instruct',
    'qwen3-8b',
    'qwen3.6-27b',
    'qwen3-235b-a22b',
    'qwen-plus',
    'qwen-turbo',
    'qwen-mt-lite',
    'qwen3.6-flash-2026-04-16',
    'qwen3-coder-flash',
    'qwen3-vl-plus',
    'qwen3-next-80b-a3b-thinking',
    'qwen3.5-27b',
    'qwen3.7-max-2026-05-17',
    'qwen3-30b-a3b',
    'qwen-mt-plus',
    'qwen3-vl-flash',
    'qwen3-vl-8b-instruct',
    'qwen3-max-2025-09-23',
    'qwen-plus-character',
    'qwen3-coder-flash-2025-07-28',
    'deepseek-v4-pro',
    'qwen-flash-character',
    'qwen3-vl-plus-2025-12-19',
    'qwen-plus-2025-04-28',
    'qwen-mt-turbo',
    'qwen3-30b-a3b-instruct-2507',
    'qwen3.5-plus',
    'qwen-flash',
    'qwen-flash-2025-07-28',
    'qwen3.6-35b-a3b',
    'qwen3-235b-a22b-instruct-2507',
    'qwq-plus',
    'qwen3.6-plus-2026-04-02',
    'qwen3-coder-plus-2025-07-22',
    'qwen3.5-plus-2026-04-20',
    'qwen3.7-max',
    'qwen3-next-80b-a3b-instruct',
    'qwen3-14b',
    'qwen-vl-ocr-2025-11-20',
    'qwen-vl-ocr',
  ],

  // ── Vision Models (47 working) — image / video generation ──────────────
  vision: [
    // Qwen-Image series (synchronous)
    'qwen-image',
    'qwen-image-2.0',
    'qwen-image-2.0-2026-03-03',
    'qwen-image-2.0-pro',
    'qwen-image-2.0-pro-2026-03-03',
    'qwen-image-2.0-pro-2026-04-22',
    'qwen-image-max',
    'qwen-image-max-2025-12-30',
    'qwen-image-plus',
    'qwen-image-plus-2026-01-09',

    // Image Edit models
    'qwen-image-edit-plus',
    'qwen-image-edit-plus-2025-10-30',
    'qwen-image-edit',
    'qwen-image-edit-max-2026-01-16',
    'qwen-image-edit-max',
    'qwen-image-edit-plus-2025-12-15',

    // Wan T2I models
    'wan2.6-t2i',
    'wan2.7-image-pro',
    'wan2.7-image',
    'z-image-turbo',

    // Async T2I models
    'wan2.5-t2i-preview',
    'wan2.1-t2i-turbo',
    'wan2.2-t2i-flash',
    'wan2.2-t2i-plus',
    'wan2.1-t2i-plus',

    // Video models - T2V
    'wan2.6-t2v',
    'wan2.6-image',
    'wan2.7-t2v',
    'wan2.7-t2v-2026-04-25',
    'wan2.2-t2v-plus',
    'wan2.5-t2v-preview',
    'wan2.1-t2v-plus',
    'wan2.1-t2v-turbo',
    'happyhorse-1.1-t2v',
    'happyhorse-1.0-t2v',

    // Video models - I2V (with img_url)
    'wan2.7-i2v',
    'wan2.7-i2v-2026-04-25',
    'wan2.6-i2v',
    'wan2.6-i2v-flash',
    'wan2.5-i2v-preview',
    'wan2.1-i2v-turbo',
    'wan2.1-i2v-plus',
    'wan2.2-i2v-flash',
    'wan2.2-i2v-plus', // Uses 1080P resolution
    'happyhorse-1.1-i2v',
    'happyhorse-1.0-i2v',

    // Video models - R2V (with reference_image)
    'wan2.7-r2v',
    'happyhorse-1.0-r2v',
    'happyhorse-1.1-r2v',
    'wan2.6-r2v-flash', // Uses reference_urls
    'wan2.6-r2v',       // Uses reference_video_urls with video URL
  ],

  // ── Multi-modal Models (8 working) — chat models with audio+image input ─
  multimodal: [
    'qwen3.5-omni-plus-2026-03-15',
    'qwen3.5-omni-plus',
    'qwen3-omni-flash',
    'qwen-omni-turbo',
    'qwen2.5-omni-7b',
    'qwen3.5-omni-flash',
    'qwen3.5-omni-flash-2026-03-15',
    'qwen3-omni-flash-2025-09-15',
  ],

  // ── Embedding Models (3 working) ─────────────────────────────────────────
  embedding: [
    'text-embedding-v3',
    'text-embedding-v4',
    'qwen3-rerank',
  ],
};

// Category metadata
const CATEGORY_META = {
  llm: { label: 'LLM', icon: '💬', color: 'blue' },
  vision: { label: 'Vision', icon: '🎨', color: 'pink' },
  multimodal: { label: 'Multi-modal', icon: '🌐', color: 'purple' },
  embedding: { label: 'Embedding', icon: '📊', color: 'gray' },
};

// Models (within `llm` and `multimodal`) that accept file uploads in chat,
// with their allowed extensions. Used to split the chat catalog into
// "text" vs "vision" (image/audio-capable) model lists.
const FILE_UPLOAD_MODELS = {
  // Vision LLM models - support images
  'qwen-vl-plus': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen-vl-max': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen-vl-ocr': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen-vl-ocr-2025-11-20': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-235b-a22b-thinking': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-235b-a22b-instruct': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-30b-a3b-thinking': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-30b-a3b-instruct': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-plus': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-plus-2025-09-23': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-plus-2025-12-19': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-flash': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-flash-2025-10-15': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-flash-2026-01-22': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-8b-thinking': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-vl-8b-instruct': { type: 'image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },

  // Omni models - support audio and images
  'qwen3.5-omni-plus-2026-03-15': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3.5-omni-plus': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-omni-flash': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen-omni-turbo': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen2.5-omni-7b': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3.5-omni-flash': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3.5-omni-flash-2026-03-15': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  'qwen3-omni-flash-2025-09-15': { type: 'audio,image', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
};

function getModelFileSupport(modelId) {
  return FILE_UPLOAD_MODELS[modelId] || null;
}

function getModelsByCategory(category) {
  return MODELS[category] || [];
}

function getAllModels() {
  const all = [];
  for (const category of Object.keys(MODELS)) {
    for (const modelId of MODELS[category]) {
      const fileSupport = getModelFileSupport(modelId);
      all.push({
        id: modelId,
        category,
        ...CATEGORY_META[category],
        supportsFileUpload: !!fileSupport,
        fileTypes: fileSupport?.type || null,
        allowedExtensions: fileSupport?.extensions || null,
      });
    }
  }
  return all;
}

function getModelById(id) {
  const all = getAllModels();
  const needle = String(id).toLowerCase();
  return all.find((m) => m.id.toLowerCase() === needle);
}

// ── Chat-catalog helpers ──────────────────────────────────────────────────
// Chat completions (modules/chatbot.js) only work against `llm` +
// `multimodal` entries. Split those into "text" vs "vision" (i.e. models
// that accept image/audio input) using the FILE_UPLOAD_MODELS map, so the
// chatbot module's catalog always reflects the full provider model list.
function getChatModels() {
  const chatCapable = [...MODELS.llm, ...MODELS.multimodal];
  const text = chatCapable.filter((id) => !FILE_UPLOAD_MODELS[id]);
  const vision = chatCapable.filter((id) => !!FILE_UPLOAD_MODELS[id]);
  return { text, vision };
}

module.exports = {
  MODELS,
  CATEGORY_META,
  FILE_UPLOAD_MODELS,
  getModelFileSupport,
  getModelsByCategory,
  getAllModels,
  getModelById,
  getChatModels,
};
