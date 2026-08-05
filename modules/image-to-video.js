// modules/image-to-video.js
// Image-to-Video module supporting Pixazo provider (LTX 2.3)
// with model-specific parameters

const pool = require('../db');
const PixazoProvider = require('../providers/pixazo');

// Provider configurations
const PIXAZO_VIDEO_MODEL = 'ltx-2.3';

// Parameters supported by Pixazo's image-to-video
const MODEL_PARAMETERS = {
  'pixazo': {
    aspect: { type: 'select', options: ['16:9', '9:16', '1:1', '4:3'], default: '16:9', label: 'Aspect Ratio' },
    frame_rate: { type: 'select', options: [24, 30], default: 24, label: 'Frame Rate' },
    width: { type: 'select', options: [768, 1024, 1280], default: 1024, label: 'Width' },
    height: { type: 'select', options: [768, 1024, 1280], default: 768, label: 'Height' },
    num_frames: { type: 'range', min: 24, max: 120, default: 48, step: 24, label: 'Frames' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
    enhance_prompt: { type: 'boolean', default: true, label: 'Enhance Prompt' },
  }
};

async function imageToVideoHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    image_url,
    provider = 'pixazo',
    model: requestedModel,
    width,
    height,
    num_frames,
    frame_rate,
    seed,
    enhance_prompt = true,
    aspect = '16:9',
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for video generation');
  }

  if (!image_url || !image_url.trim()) {
    throw new Error('Source image URL is required for image-to-video');
  }

  // Determine provider
  let selectedProvider = provider;
  
  if (requestedModel && requestedModel === PIXAZO_VIDEO_MODEL) {
    selectedProvider = 'pixazo';
  }

  // Check API keys
  if (selectedProvider === 'pixazo' && !apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }

  let videoUrl, requestId, status, model;

  if (selectedProvider === 'pixazo') {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    
    model = PIXAZO_VIDEO_MODEL;
    
    try {
      const params = {
        prompt,
        image_url, // Required for image-to-video
        aspect_ratio: aspect,
        frame_rate: parseInt(frame_rate) || 24,
        width: parseInt(width) || 1024,
        height: parseInt(height) || 768,
        num_frames: parseInt(num_frames) || 48,
        enhance_prompt,
      };
      if (seed) params.seed = parseInt(seed);
      
      const result = await pixazo.generateVideo('image-to-video', params);
      requestId = result.request_id;
      status = result.status || 'QUEUED';
      videoUrl = null; // Will be available after polling
    } catch (err) {
      throw new Error(`Pixazo Image-to-Video error: ${err.message}`);
    }
  }

  return {
    videoUrl,
    requestId,
    status,
    provider: selectedProvider,
    model,
    parameters: { width, height, num_frames, frame_rate, seed, enhance_prompt, aspect, image_url }
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
  imageToVideoHandler,
  checkVideoStatus,
  getModelCatalog,
  MODEL_PARAMETERS,
  PIXAZO_VIDEO_MODEL
};
