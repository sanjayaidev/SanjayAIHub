// modules/text-to-speech.js
// Text-to-Speech module supporting multiple providers (Cloudflare, ElevenLabs)
// with model-specific parameters

const pool = require('../db');
const CloudflareProvider = require('../providers/cloudflare');
const ElevenLabsProvider = require('../providers/elevenlabs');

// Provider configurations
const CLOUDFLARE_TTS_MODELS = [
  '@cf/myshell-ai/melotts',
];

const ELEVENLABS_TTS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_flash_v2',
  'eleven_turbo_v2',
  'eleven_v3',
];

const DEFAULT_CLOUDFLARE_MODEL = '@cf/myshell-ai/melotts';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';

// Parameters supported by each provider
const MODEL_PARAMETERS = {
  'cloudflare': {
    language: { 
      type: 'select', 
      options: ['en', 'es', 'fr', 'zh', 'ja', 'ko'], 
      default: 'en',
      label: 'Language'
    },
  },
  'elevenlabs': {
    voice_id: {
      type: 'select',
      options: [], // Will be populated dynamically from API
      default: '21m00Tcm4TlvDq8ikWAM', // Rachel voice
      label: 'Voice'
    },
    stability: { 
      type: 'range', 
      min: 0, max: 1, default: 0.5, step: 0.05,
      label: 'Stability'
    },
    similarity_boost: { 
      type: 'range', 
      min: 0, max: 1, default: 0.75, step: 0.05,
      label: 'Similarity Boost'
    },
    model_id: {
      type: 'select',
      options: ELEVENLABS_TTS_MODELS,
      default: DEFAULT_ELEVENLABS_MODEL,
      label: 'Model'
    }
  }
};

async function ttsHandler(requestBody, apiKeys, userId) {
  const {
    text,
    provider = 'cloudflare',
    model: requestedModel,
    language = 'en',
    voice_id,
    stability,
    similarity_boost,
    model_id,
  } = requestBody;

  if (!text || !text.trim()) {
    throw new Error('Text is required for TTS generation');
  }

  // Determine provider based on request or availability
  let selectedProvider = provider;
  
  if (requestedModel) {
    if (ELEVENLABS_TTS_MODELS.includes(requestedModel)) {
      selectedProvider = 'elevenlabs';
    } else if (CLOUDFLARE_TTS_MODELS.includes(requestedModel)) {
      selectedProvider = 'cloudflare';
    }
  }

  // Check API keys
  if (selectedProvider === 'cloudflare' && (!apiKeys.cloudflare?.api_key || !apiKeys.cloudflare?.account_id)) {
    throw new Error('Cloudflare API token + Account ID not configured. Add them in Profile > API Keys.');
  }
  
  if (selectedProvider === 'elevenlabs' && !apiKeys.elevenlabs?.api_key) {
    throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
  }

  let audioBase64, contentType;

  if (selectedProvider === 'cloudflare') {
    const cloudflare = new CloudflareProvider(
      apiKeys.cloudflare.api_key,
      apiKeys.cloudflare.account_id
    );
    
    try {
      const result = await cloudflare.textToSpeech(text, { lang: language });
      audioBase64 = result.audioBase64;
      contentType = result.contentType;
    } catch (err) {
      throw new Error(`Cloudflare TTS error: ${err.message}`);
    }
  } else {
    const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
    
    try {
      const voiceSettings = {};
      if (stability !== undefined) voiceSettings.stability = parseFloat(stability);
      if (similarity_boost !== undefined) voiceSettings.similarity_boost = parseFloat(similarity_boost);
      
      const result = await elevenlabs.textToSpeech(
        text, 
        voice_id || '21m00Tcm4TlvDq8ikWAM',
        { 
          model_id: model_id || DEFAULT_ELEVENLABS_MODEL,
          voice_settings: voiceSettings
        }
      );
      audioBase64 = result.audioBase64;
      contentType = result.contentType;
    } catch (err) {
      throw new Error(`ElevenLabs TTS error: ${err.message}`);
    }
  }

  return {
    audioBase64,
    contentType,
    provider: selectedProvider,
    model: selectedProvider === 'cloudflare' ? DEFAULT_CLOUDFLARE_MODEL : (model_id || DEFAULT_ELEVENLABS_MODEL),
    parameters: { language, voice_id, stability, similarity_boost }
  };
}

async function getVoices(apiKeys) {
  if (!apiKeys.elevenlabs?.api_key) {
    return [];
  }
  
  try {
    const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
    const voicesData = await elevenlabs.listVoices();
    return voicesData.voices || [];
  } catch (err) {
    console.error('Failed to fetch ElevenLabs voices:', err);
    return [];
  }
}

function getModelCatalog(userTier) {
  return {
    providers: ['cloudflare', 'elevenlabs'],
    models: {
      cloudflare: CLOUDFLARE_TTS_MODELS,
      elevenlabs: ELEVENLABS_TTS_MODELS
    },
    defaults: {
      cloudflare: DEFAULT_CLOUDFLARE_MODEL,
      elevenlabs: DEFAULT_ELEVENLABS_MODEL
    },
    parameters: MODEL_PARAMETERS
  };
}

module.exports = {
  ttsHandler,
  getVoices,
  getModelCatalog,
  MODEL_PARAMETERS,
  CLOUDFLARE_TTS_MODELS,
  ELEVENLABS_TTS_MODELS
};
