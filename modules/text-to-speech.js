// modules/text-to-speech.js
// Text-to-Speech module supporting multiple providers (Cloudflare,
// ElevenLabs, Alibaba Cloud) with model-specific parameters.
//
// Alibaba is a special case: it doesn't offer preset TTS voices here, only
// synthesis with a voice the user has already cloned via the Voice Cloning
// module (modules/voice-clone.js / AlibabaProvider.synthesizeWithClonedVoice).
// Because that's a paid feature, it's gated to non-trial subscription tiers
// — see the userTier check in ttsHandler() and getModelCatalog() below.

const pool = require('../db');
const CloudflareProvider = require('../providers/cloudflare');
const ElevenLabsProvider = require('../providers/elevenlabs');
const AlibabaProvider = require('../providers/alibaba');

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

// Alibaba TTS here is really "synthesize with a voice I already cloned" —
// there's only one callable model (see AlibabaProvider.VOICE_CLONE_MODEL).
const ALIBABA_TTS_MODELS = [AlibabaProvider.VOICE_CLONE_MODEL];

const DEFAULT_CLOUDFLARE_MODEL = '@cf/myshell-ai/melotts';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';
const DEFAULT_ALIBABA_MODEL = AlibabaProvider.VOICE_CLONE_MODEL;

// Subscription tiers allowed to use the Alibaba cloned-voice TTS option.
// Matches the 'voice-clone' module's own access_level ('basic') in Tables.sql
// — you need a paid plan to have cloned a voice in the first place.
const ALIBABA_TTS_ALLOWED_TIERS = ['basic', 'pro', 'enterprise'];

// DashScope's synthesis endpoint wants a full language name ("English"),
// matching the mapping already used in modules/voice-clone.js.
const ALIBABA_LANGUAGE_NAMES = {
  en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian',
};

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
  },
  'alibaba': {
    voiceId: {
      type: 'select',
      options: [], // Populated dynamically from the user's cloned voices (see GET /api/modules/voice-clone/voices)
      default: '',
      label: 'Cloned Voice'
    },
    language: {
      type: 'select',
      options: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'ru'],
      default: 'en',
      label: 'Language'
    },
  }
};

async function ttsHandler(requestBody, apiKeys, userId, userTier = 'trial') {
  const {
    text,
    provider = 'cloudflare',
    model: requestedModel,
    language = 'en',
    voice_id,
    stability,
    similarity_boost,
    model_id,
    voiceId,
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
    } else if (ALIBABA_TTS_MODELS.includes(requestedModel)) {
      selectedProvider = 'alibaba';
    }
  }

  // Check API keys
  if (selectedProvider === 'cloudflare' && (!apiKeys.cloudflare?.api_key || !apiKeys.cloudflare?.account_id)) {
    throw new Error('Cloudflare API token + Account ID not configured. Add them in Profile > API Keys.');
  }
  
  if (selectedProvider === 'elevenlabs' && !apiKeys.elevenlabs?.api_key) {
    throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
  }

  if (selectedProvider === 'alibaba') {
    // Cloned-voice synthesis is a paid-plan feature — same gate as the
    // Voice Cloning module itself, checked here too since ttsHandler can be
    // reached directly and shouldn't rely on the frontend hiding the option.
    if (!ALIBABA_TTS_ALLOWED_TIERS.includes(userTier)) {
      throw new Error('Alibaba voice-clone TTS is available on paid plans (Basic and above). Upgrade your plan, or use Cloudflare/ElevenLabs instead.');
    }
    if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
      throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
    }
    if (!voiceId) {
      throw new Error('voiceId is required — clone a voice first in the Voice Cloning module.');
    }
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
  } else if (selectedProvider === 'alibaba') {
    const alibaba = new AlibabaProvider(apiKeys.alibaba.api_key, apiKeys.alibaba.workspace_id);
    const languageType = ALIBABA_LANGUAGE_NAMES[(language || 'en').toLowerCase()] || 'English';

    try {
      const result = await alibaba.synthesizeWithClonedVoice(text, voiceId, languageType);
      audioBase64 = result.audioBase64;
      contentType = result.contentType;
    } catch (err) {
      throw new Error(`Alibaba TTS error: ${err.message}`);
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

  const modelUsed = selectedProvider === 'cloudflare'
    ? DEFAULT_CLOUDFLARE_MODEL
    : selectedProvider === 'alibaba'
      ? DEFAULT_ALIBABA_MODEL
      : (model_id || DEFAULT_ELEVENLABS_MODEL);

  return {
    audioBase64,
    contentType,
    provider: selectedProvider,
    model: modelUsed,
    parameters: { language, voice_id, stability, similarity_boost, voiceId }
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
  const includeAlibaba = ALIBABA_TTS_ALLOWED_TIERS.includes(userTier);

  const providers = ['cloudflare', 'elevenlabs'];
  const models = {
    cloudflare: CLOUDFLARE_TTS_MODELS,
    elevenlabs: ELEVENLABS_TTS_MODELS
  };
  const defaults = {
    cloudflare: DEFAULT_CLOUDFLARE_MODEL,
    elevenlabs: DEFAULT_ELEVENLABS_MODEL
  };

  if (includeAlibaba) {
    providers.push('alibaba');
    models.alibaba = ALIBABA_TTS_MODELS;
    defaults.alibaba = DEFAULT_ALIBABA_MODEL;
  }

  return {
    providers,
    models,
    defaults,
    parameters: MODEL_PARAMETERS
  };
}

module.exports = {
  ttsHandler,
  getVoices,
  getModelCatalog,
  MODEL_PARAMETERS,
  CLOUDFLARE_TTS_MODELS,
  ELEVENLABS_TTS_MODELS,
  ALIBABA_TTS_MODELS,
  ALIBABA_TTS_ALLOWED_TIERS
};