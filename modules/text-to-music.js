// modules/text-to-music.js
// Text-to-Music module supporting Pixazo provider (Ace Step)
// with model-specific parameters

const pool = require('../db');
const PixazoProvider = require('../providers/pixazo');

// Provider configurations
const PIXAZO_MUSIC_MODEL = 'ace-step';

// Parameters supported by Pixazo's Ace Step model
const MODEL_PARAMETERS = {
  'pixazo': {
    prompt: { type: 'text', default: '', label: 'Music Description' },
    lyrics: { type: 'text', default: '', label: 'Lyrics (optional)', optional: true },
    instrumental: { type: 'boolean', default: false, label: 'Instrumental Only' },
    duration: { type: 'select', options: [15, 30, 60], default: 30, label: 'Duration (seconds)' },
    bpm: { type: 'number', min: 60, max: 200, default: 120, label: 'BPM (optional)' },
    infer_steps: { type: 'range', min: 10, max: 100, default: 50, step: 5, label: 'Inference Steps' },
    guidance_scale: { type: 'range', min: 1, max: 10, default: 5, step: 0.5, label: 'Guidance Scale' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
  }
};

async function textToMusicHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    provider = 'pixazo',
    model: requestedModel,
    lyrics,
    instrumental = false,
    duration = 30,
    bpm,
    infer_steps = 50,
    guidance_scale = 5,
    seed,
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Music description is required for music generation');
  }

  // Determine provider
  let selectedProvider = provider;
  
  if (requestedModel && requestedModel === PIXAZO_MUSIC_MODEL) {
    selectedProvider = 'pixazo';
  }

  // Check API keys
  if (selectedProvider === 'pixazo' && !apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }

  let audioUrl, requestId, status, model;

  if (selectedProvider === 'pixazo') {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    
    model = PIXAZO_MUSIC_MODEL;
    
    try {
      const params = {
        prompt,
        lyrics: lyrics || '',
        instrumental,
        duration: parseInt(duration),
        infer_steps: parseInt(infer_steps),
        guidance_scale: parseFloat(guidance_scale),
      };
      
      if (bpm) params.bpm = parseInt(bpm);
      if (seed) params.seed = parseInt(seed);
      
      const result = await pixazo.generateAudio(params);
      requestId = result.request_id;
      status = result.status || 'QUEUED';
      audioUrl = null; // Will be available after polling
    } catch (err) {
      throw new Error(`Pixazo Text-to-Music error: ${err.message}`);
    }
  }

  return {
    audioUrl,
    requestId,
    status,
    provider: selectedProvider,
    model,
    parameters: { prompt, lyrics, instrumental, duration, bpm, infer_steps, guidance_scale, seed }
  };
}

async function checkAudioStatus(requestId, apiKeys) {
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
      audioUrl: result.output?.media_url?.[0] || null,
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
      pixazo: [PIXAZO_MUSIC_MODEL]
    },
    defaults: {
      pixazo: PIXAZO_MUSIC_MODEL
    },
    parameters: MODEL_PARAMETERS,
    supportsAsync: true
  };
}

module.exports = {
  textToMusicHandler,
  checkAudioStatus,
  getModelCatalog,
  MODEL_PARAMETERS,
  PIXAZO_MUSIC_MODEL
};
