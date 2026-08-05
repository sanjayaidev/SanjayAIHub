// modules/text-to-video.js
// Text-to-Video module supporting multiple providers (Alibaba, Pixazo)
// with model-specific parameters based on https://github.com/sanjayaidev/AlibabaCloud

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const PixazoProvider = require('../providers/pixazo');
const alibabaModels = require('../providers/alibaba-models');

// Provider configurations - from alibaba-models.js vision category (video models)
const ALIBABA_VIDEO_MODELS = alibabaModels.getModelsByCategory('vision').filter(m => 
  m.includes('-t2v') || m.includes('-i2v') || m.includes('-r2v') || m === 'wan2.6-image'
);

const PIXAZO_VIDEO_MODEL = 'ltx-2.3';

// Parameters supported by each provider's models
// Based on https://github.com/sanjayaidev/AlibabaCloud index.js /v1/videos/generations
const MODEL_PARAMETERS = {
  'alibaba': {
    size: {
      type: 'select',
      options: ['480x480', '720x720', '1080x1080', '1280x720', '720x1280', '1920x1080', '1080x1920'],
      default: '720x720',
      label: 'Resolution'
    },
    duration: { type: 'select', options: [5, 10], default: 5, label: 'Duration (seconds)' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
    negative_prompt: { type: 'text', default: '', label: 'Negative prompt (optional)' },
  },
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

async function textToVideoHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    provider = 'pixazo',
    model: requestedModel,
    width,
    height,
    num_frames,
    frame_rate,
    duration,
    seed,
    enhance_prompt = true,
    aspect = '16:9',
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for video generation');
  }

  // Determine provider based on request or availability
  let selectedProvider = provider;
  
  if (requestedModel) {
    if (ALIBABA_VIDEO_MODELS.includes(requestedModel)) {
      selectedProvider = 'alibaba';
    } else if (requestedModel === PIXAZO_VIDEO_MODEL) {
      selectedProvider = 'pixazo';
    }
  }

  // Check API keys
  if (selectedProvider === 'alibaba' && (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id)) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }
  
  if (selectedProvider === 'pixazo' && !apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }

  let videoUrl, requestId, status, model;

  if (selectedProvider === 'alibaba') {
    const alibaba = new AlibabaProvider(
      apiKeys.alibaba.api_key,
      apiKeys.alibaba.workspace_id
    );
    
    model = requestedModel || 'wan2.6-t2v';
    
    try {
      // Build size from width/height or use default
      const size = (width && height) ? `${parseInt(width)}x${parseInt(height)}` : '720x720';
      
      // Submit async video generation task
      const result = await alibaba.videoGeneration(prompt, {
        model,
        size,
        duration: parseInt(duration) || 5,
        seed: seed ? parseInt(seed) : undefined,
      });

      // DashScope returns: { output: { task_id, task_status } }
      requestId = result?.output?.task_id;
      status = result?.output?.task_status || 'PENDING';
      videoUrl = null; // Will be available after polling via checkVideoTask
    } catch (err) {
      throw new Error(`Alibaba Video error: ${err.message}`);
    }
  } else {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    
    model = PIXAZO_VIDEO_MODEL;
    
    try {
      const params = {
        prompt,
        aspect_ratio: aspect,
        frame_rate: parseInt(frame_rate) || 24,
        width: parseInt(width) || 1024,
        height: parseInt(height) || 768,
        num_frames: parseInt(num_frames) || 48,
        enhance_prompt,
      };
      if (seed) params.seed = parseInt(seed);
      
      const result = await pixazo.generateVideo('text-to-video', params);
      requestId = result.request_id;
      status = result.status || 'QUEUED';
      videoUrl = null; // Will be available after polling
    } catch (err) {
      throw new Error(`Pixazo Video error: ${err.message}`);
    }
  }

  return {
    videoUrl,
    requestId,
    status,
    provider: selectedProvider,
    model,
    parameters: { width, height, num_frames, frame_rate, duration, seed, enhance_prompt, aspect }
  };
}

async function checkVideoStatus(requestId, apiKeys, provider = 'pixazo') {
  if (!requestId) {
    throw new Error('Request ID is required');
  }
  
  if (provider === 'alibaba') {
    if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
      throw new Error('Alibaba Cloud API key + Workspace ID not configured');
    }
    
    const alibaba = new AlibabaProvider(
      apiKeys.alibaba.api_key,
      apiKeys.alibaba.workspace_id
    );
    
    try {
      const result = await alibaba.checkVideoTask(requestId);
      const taskStatus = result?.output?.task_status;
      let status = 'pending';
      
      if (taskStatus === 'SUCCEEDED') status = 'completed';
      else if (taskStatus === 'FAILED') status = 'failed';
      else if (taskStatus === 'RUNNING') status = 'processing';
      else status = 'pending';
      
      return {
        status,
        videoUrl: result?.output?.video_url || null,
        progress: status === 'completed' ? 100 : (status === 'processing' ? 50 : 0)
      };
    } catch (err) {
      throw new Error(`Alibaba status check error: ${err.message}`);
    }
  } else {
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
}

function getModelCatalog(userTier) {
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);
  
  return {
    providers: ['alibaba', 'pixazo'],
    models: {
      alibaba: isPaid ? ALIBABA_VIDEO_MODELS : [],
      pixazo: [PIXAZO_VIDEO_MODEL]
    },
    defaults: {
      alibaba: 'wan2.6-t2v',
      pixazo: PIXAZO_VIDEO_MODEL
    },
    parameters: MODEL_PARAMETERS,
    supportsAsync: true
  };
}

module.exports = {
  textToVideoHandler,
  checkVideoStatus,
  getModelCatalog,
  MODEL_PARAMETERS,
  ALIBABA_VIDEO_MODELS,
  PIXAZO_VIDEO_MODEL
};
