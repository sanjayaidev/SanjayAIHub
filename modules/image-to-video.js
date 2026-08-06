// modules/image-to-video.js
// Image-to-Video module supporting Alibaba and Pixazo providers
// with model-specific parameters based on https://github.com/sanjayaidev/AlibabaCloud

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const PixazoProvider = require('../providers/pixazo');
const alibabaModels = require('../providers/alibaba-models');

// Provider configurations - I2V models from alibaba-models.js vision category
const ALIBABA_I2V_MODELS = alibabaModels.getModelsByCategory('vision').filter(m => 
  m.includes('-i2v') || m.includes('-r2v')
);

const PIXAZO_VIDEO_MODEL = 'ltx-2.3';

// Parameters supported by each provider's models
// Alibaba video-synthesis: source frame(s) go in `input.media`, sizing is a
// `resolution` preset (no `ratio` needed here — the source frame already
// fixes the aspect ratio for I2V).
const MODEL_PARAMETERS = {
  'alibaba': {
    resolution: {
      type: 'select',
      options: ['480P', '720P', '1080P'],
      default: '720P',
      label: 'Resolution'
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
    // Overridden by `aspect` when set; kept for the custom/no-aspect case.
    // Must stay <= 1920 / <= 1088 and divisible by 32 (LTX 2.3 hard limits).
    width: { type: 'select', options: [768, 1024, 1280, 1536, 1920], default: 1280, label: 'Width' },
    height: { type: 'select', options: [576, 704, 832, 1088], default: 704, label: 'Height' },
    // LTX 2.3 requires the "8k+1" frame-count form (max 241).
    num_frames: { type: 'select', options: [41, 81, 121, 161, 201, 241], default: 121, label: 'Frames' },
    seed_mode: { type: 'checkbox', default: false, label: 'Use fixed seed' },
    seed: { type: 'range', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'seed_mode', label: 'Seed' },
    enhance_prompt: { type: 'boolean', default: true, label: 'Enhance Prompt' },
  }
};

async function imageToVideoHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    image_url,
    last_frame_url,
    driving_audio_url,
    provider = 'pixazo',
    model: requestedModel,
    width,
    height,
    num_frames,
    frame_rate,
    seed,
    enhance_prompt = true,
    aspect = '16:9',
    resolution,
    duration,
    negative_prompt,
    prompt_extend = true,
    watermark = true,
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for video generation');
  }

  if (!image_url || !image_url.trim()) {
    throw new Error('Source image URL is required for image-to-video');
  }

  // Determine provider
  let selectedProvider = provider;

  if (requestedModel) {
    if (ALIBABA_I2V_MODELS.includes(requestedModel)) selectedProvider = 'alibaba';
    else if (requestedModel === PIXAZO_VIDEO_MODEL) selectedProvider = 'pixazo';
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

    model = ALIBABA_I2V_MODELS.includes(requestedModel) ? requestedModel : 'wan2.7-i2v';

    // media: first_frame is required; last_frame and driving_audio are
    // optional extras some Wan models accept (e.g. lip-sync/rap videos).
    const media = [{ type: 'first_frame', url: image_url }];
    if (last_frame_url && last_frame_url.trim()) media.push({ type: 'last_frame', url: last_frame_url });
    if (driving_audio_url && driving_audio_url.trim()) media.push({ type: 'driving_audio', url: driving_audio_url });

    try {
      const result = await alibaba.videoGeneration(prompt, {
        model,
        media,
        resolution: resolution || '720P',
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
      throw new Error(`Alibaba Image-to-Video error: ${err.message}`);
    }
  } else if (selectedProvider === 'pixazo') {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    
    model = PIXAZO_VIDEO_MODEL;
    
    try {
      const params = {
        prompt,
        image_url, // Required for image-to-video
        // Pixazo's LTX API field is `aspect`, not `aspect_ratio` — sending
        // the wrong key meant the user's chosen ratio was silently dropped.
        aspect,
        frame_rate: parseInt(frame_rate) || 24,
        width: parseInt(width) || 1280,
        height: parseInt(height) || 704,
        num_frames: parseInt(num_frames) || 121,
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
    parameters: selectedProvider === 'alibaba'
      ? { resolution, duration, seed, negative_prompt, prompt_extend, watermark, image_url, last_frame_url, driving_audio_url }
      : { width, height, num_frames, frame_rate, seed, enhance_prompt, aspect, image_url }
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
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);

  return {
    providers: ['alibaba', 'pixazo'],
    models: {
      alibaba: isPaid ? ALIBABA_I2V_MODELS : [],
      pixazo: [PIXAZO_VIDEO_MODEL]
    },
    defaults: {
      alibaba: 'wan2.7-i2v',
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