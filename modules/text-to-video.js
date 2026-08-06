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
    resolution: {
      type: 'select',
      options: ['480P', '720P', '1080P'],
      default: '720P',
      label: 'Resolution'
    },
    ratio: {
      type: 'select',
      options: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      default: '16:9',
      label: 'Aspect Ratio'
    },
    duration: { type: 'select', options: [5, 10], default: 5, label: 'Duration (seconds)' },
    seed_mode: { type: 'checkbox', default: false, label: 'Use fixed seed' },
    seed: { type: 'range', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'seed_mode', label: 'Seed' },
    negative_prompt: { type: 'text', default: '', label: 'Negative prompt (optional)' },
    prompt_extend: { type: 'boolean', default: true, label: 'Smart prompt rewriting' },
    watermark: { type: 'boolean', default: true, label: 'Add watermark' },
  },
  'pixazo': {
    aspect: { type: 'select', options: ['16:9', '9:16', '1:1', '4:3'], default: '16:9', label: 'Aspect Ratio' },
    frame_rate: { type: 'select', options: [24, 30], default: 24, label: 'Frame Rate' },
    width: { type: 'select', options: [768, 1024, 1280], default: 1024, label: 'Width' },
    height: { type: 'select', options: [768, 1024, 1280], default: 768, label: 'Height' },
    num_frames: { type: 'range', min: 24, max: 120, default: 48, step: 24, label: 'Frames' },
    seed_mode: { type: 'checkbox', default: false, label: 'Use fixed seed' },
    seed: { type: 'range', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'seed_mode', label: 'Seed' },
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
    resolution,
    ratio,
    negative_prompt,
    prompt_extend = true,
    watermark = true,
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
      // Submit async video generation task. Pure T2V models have no source
      // frame to infer aspect ratio from, so `ratio` is sent alongside
      // `resolution` (e.g. "720P" + "16:9") rather than a pixel size.
      const result = await alibaba.videoGeneration(prompt, {
        model,
        resolution: resolution || '720P',
        ratio: ratio || aspect || '16:9',
        duration: parseInt(duration) || 5,
        seed: seed ? parseInt(seed) : undefined,
        negative_prompt,
        prompt_extend,
        watermark,
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
    parameters: selectedProvider === 'alibaba'
      ? { resolution, ratio: ratio || aspect, duration, seed, negative_prompt, prompt_extend, watermark }
      : { width, height, num_frames, frame_rate, duration, seed, enhance_prompt, aspect }
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