// modules/video-to-video.js
// Video-to-Video module — Alibaba (Wan I2V/R2V) and Pixazo (LTX 2.3)
// with model-specific parameters based on https://github.com/sanjayaidev/AlibabaCloud

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const PixazoProvider = require('../providers/pixazo');
const alibabaModels = require('../providers/alibaba-models');

// Provider configurations - R2V models from alibaba-models.js vision category
const ALIBABA_R2V_MODELS = alibabaModels.getModelsByCategory('vision').filter(m => 
  m.includes('-r2v')
);

const PIXAZO_VIDEO_MODEL = 'ltx-2.3';

// Parameters supported by each provider's models
// Based on https://github.com/sanjayaidev/AlibabaCloud - video generation uses prompt + optional reference_video_urls
const MODEL_PARAMETERS = {
  'alibaba': {
    size: {
      type: 'select',
      options: ['480x480', '720x720', '1080x1080', '1280x720', '720x1280', '1920x1080', '1080x1920'],
      default: '720x720',
      label: 'Resolution'
    },
    duration: { type: 'select', options: [5, 10], default: 5, label: 'Duration (seconds)' },
    seed_mode: { type: 'checkbox', default: false, label: 'Use fixed seed' },
    seed: { type: 'range', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'seed_mode', label: 'Seed' },
  },
  'pixazo': {
    strength: { type: 'range', min: 0, max: 1, default: 0.6, step: 0.05, label: 'Transform Strength' },
    frame_rate: { type: 'select', options: [24, 30], default: 24, label: 'Frame Rate' },
    // Must stay <= 1920 / <= 1088 and divisible by 32 (LTX 2.3 hard limits).
    width: { type: 'select', options: [768, 1024, 1280, 1536, 1920], default: 1280, label: 'Width' },
    height: { type: 'select', options: [576, 704, 832, 1088], default: 704, label: 'Height' },
    seed_mode: { type: 'checkbox', default: false, label: 'Use fixed seed' },
    seed: { type: 'range', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'seed_mode', label: 'Seed' },
    enhance_prompt: { type: 'boolean', default: true, label: 'Enhance Prompt' },
  }
};

async function videoToVideoHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    video_url,
    provider = 'pixazo',
    strength = 0.6,
    width,
    height,
    frame_rate,
    seed,
    enhance_prompt = true,
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for video-to-video generation');
  }

  if (!video_url || !video_url.trim()) {
    throw new Error('Source video URL is required for video-to-video');
  }

  if (provider !== 'pixazo') {
    throw new Error(`Unsupported video-to-video provider "${provider}". Only Pixazo is currently supported.`);
  }

  if (!apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }

  const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);

  let requestId, status;

  try {
    const params = {
      prompt,
      video_url,
      strength: parseFloat(strength),
      frame_rate: parseInt(frame_rate) || 24,
      enhance_prompt,
    };
    if (width) params.width = parseInt(width);
    if (height) params.height = parseInt(height);
    if (seed) params.seed = parseInt(seed);

    const result = await pixazo.generateVideo('video-to-video', params);
    requestId = result.request_id;
    status = result.status || 'QUEUED';
  } catch (err) {
    throw new Error(`Pixazo Video-to-Video error: ${err.message}`);
  }

  return {
    videoUrl: null, // available after polling
    requestId,
    status,
    provider: 'pixazo',
    model: PIXAZO_VIDEO_MODEL,
    parameters: { strength, width, height, frame_rate, seed, enhance_prompt, video_url }
  };
}

async function checkVideoStatus(requestId, apiKeys) {
  if (!requestId) {
    throw new Error('Request ID is required');
  }

  if (!apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured');
  }

  const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);

  try {
    const result = await pixazo.checkStatus(requestId);
    return {
      status: result.status,
      videoUrl: result.output?.media_url?.[0] || null,
      progress: result.progress || 0
    };
  } catch (err) {
    throw new Error(`Pixazo status check error: ${err.message}`);
  }
}

function getModelCatalog(userTier) {
  return {
    providers: ['pixazo'],
    models: {
      pixazo: [PIXAZO_VIDEO_MODEL]
    },
    defaults: {
      pixazo: PIXAZO_VIDEO_MODEL
    },
    parameters: MODEL_PARAMETERS,
    supportsAsync: true
  };
}

module.exports = {
  videoToVideoHandler,
  checkVideoStatus,
  getModelCatalog,
  MODEL_PARAMETERS,
  PIXAZO_VIDEO_MODEL
};
