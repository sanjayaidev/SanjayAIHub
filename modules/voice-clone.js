// modules/voice-clone.js
// Voice Cloning module — supports two providers:
//   - Alibaba Cloud (DashScope Qwen3-TTS-VC): clone from ONE sample, then
//     synthesize speech with the cloned voice. This is the default/primary
//     path (matches the "Alibaba Cloud" option already exposed in the UI).
//   - ElevenLabs Instant Voice Cloning: clone from one-or-more samples,
//     then synthesize via ElevenLabs' own TTS.
//
// Audio samples travel as base64 in the JSON body (data URLs or raw base64),
// same convention this app already uses for imageDataUrl / audioBase64, so
// no multipart/multer plumbing is needed on top of the existing JSON API.

const ElevenLabsProvider = require('../providers/elevenlabs');
const AlibabaProvider = require('../providers/alibaba');

const MODEL_PARAMETERS = {
  'alibaba': {
    name: { type: 'text', default: '', label: 'Voice Name' },
    language: {
      type: 'select',
      options: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'ru'],
      default: 'en',
      label: 'Language'
    },
  },
  'elevenlabs': {
    name: { type: 'text', default: '', label: 'Voice Name' },
    description: { type: 'text', default: '', label: 'Description (optional)' },
  }
};

// DashScope's synthesis endpoint wants a full language name ("English"),
// while the enrollment endpoint wants a short code ("en") — map the short
// codes the UI uses (e.g. from a <select>) to what synthesis expects.
const ALIBABA_LANGUAGE_NAMES = {
  en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian',
};

// Accepts "data:audio/mpeg;base64,AAAA..." or a bare base64 string.
function decodeSample(sample, index) {
  if (!sample || typeof sample !== 'string') {
    throw new Error(`Audio sample #${index + 1} is missing or invalid`);
  }
  const match = sample.match(/^data:(.+);base64,(.+)$/);
  const mimetype = match ? match[1] : 'audio/mpeg';
  const base64 = match ? match[2] : sample;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error(`Audio sample #${index + 1} could not be decoded`);
  }
  const ext = mimetype.split('/')[1] || 'mp3';
  return { buffer, filename: `sample-${index + 1}.${ext}`, mimetype };
}

// ────────────────────────────────────────────────────────────
// Clone
// ────────────────────────────────────────────────────────────

// If given a plain http(s) URL (e.g. from the "paste a URL" audio source
// option), fetch it and convert to a base64 data URL — the Alibaba
// enrollment API only accepts base64/data URLs, not remote links.
// Already-base64/data-url samples pass through unchanged.
async function resolveAudioSample(sample) {
  if (!sample) throw new Error('Audio sample is required');
  if (!/^https?:\/\//i.test(sample)) return sample;

  const response = await fetch(sample);
  if (!response.ok) throw new Error(`Failed to fetch audio sample from URL (HTTP ${response.status})`);
  const contentType = response.headers.get('content-type') || 'audio/wav';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

async function cloneWithAlibaba(requestBody, apiKeys) {
  const { name, samples, language = 'en' } = requestBody;

  if (!name || !name.trim()) {
    throw new Error('Voice name is required');
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('An audio sample is required for voice cloning');
  }
  if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }

  // Alibaba enrollment takes a single audio sample (unlike ElevenLabs'
  // multi-file IVC), so only the first sample is used if several are sent.
  const alibaba = new AlibabaProvider(apiKeys.alibaba.api_key, apiKeys.alibaba.workspace_id);

  let result;
  try {
    const audioDataUrl = await resolveAudioSample(samples[0]);
    result = await alibaba.cloneVoice(name, audioDataUrl, language);
  } catch (err) {
    throw new Error(`Alibaba voice cloning error: ${err.message}`);
  }

  return {
    voiceId: result.voiceId,
    name: result.voiceName,
    provider: 'alibaba',
    model: AlibabaProvider.VOICE_CLONE_MODEL,
    parameters: { name, language, sampleCount: 1 }
  };
}

async function cloneWithElevenLabs(requestBody, apiKeys) {
  const { name, description, samples } = requestBody;

  if (!name || !name.trim()) {
    throw new Error('Voice name is required');
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('At least one audio sample is required for voice cloning');
  }
  if (!apiKeys.elevenlabs?.api_key) {
    throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
  }

  const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
  const files = samples.map(decodeSample);

  let result;
  try {
    result = await elevenlabs.cloneVoice(name, files, { description });
  } catch (err) {
    throw new Error(`ElevenLabs voice cloning error: ${err.message}`);
  }

  return {
    voiceId: result.voice_id,
    name,
    provider: 'elevenlabs',
    model: 'instant-voice-cloning',
    parameters: { name, description, sampleCount: files.length }
  };
}

// provider defaults to 'alibaba' since that's the primary path surfaced
// in the Voice Cloning UI.
async function voiceCloneHandler(requestBody, apiKeys, userId) {
  const provider = requestBody.provider === 'elevenlabs' ? 'elevenlabs' : 'alibaba';
  return provider === 'elevenlabs'
    ? cloneWithElevenLabs(requestBody, apiKeys)
    : cloneWithAlibaba(requestBody, apiKeys);
}

// ────────────────────────────────────────────────────────────
// Generate / synthesize speech with a previously cloned voice
// ────────────────────────────────────────────────────────────

async function synthesizeHandler(requestBody, apiKeys, userId) {
  const { text, voiceId, provider = 'alibaba', language } = requestBody;

  if (!text || !text.trim()) {
    throw new Error('Text to speak is required');
  }
  if (!voiceId) {
    throw new Error('voiceId is required — clone a voice first');
  }

  if (provider === 'elevenlabs') {
    if (!apiKeys.elevenlabs?.api_key) {
      throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
    }
    const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
    try {
      const result = await elevenlabs.textToSpeech(text, voiceId);
      return {
        audioBase64: result.audioBase64,
        contentType: result.contentType,
        provider: 'elevenlabs',
        voiceId
      };
    } catch (err) {
      throw new Error(`ElevenLabs speech synthesis error: ${err.message}`);
    }
  }

  if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }
  const alibaba = new AlibabaProvider(apiKeys.alibaba.api_key, apiKeys.alibaba.workspace_id);
  const languageType = ALIBABA_LANGUAGE_NAMES[(language || 'en').toLowerCase()] || 'English';
  try {
    const result = await alibaba.synthesizeWithClonedVoice(text, voiceId, languageType);
    return {
      audioBase64: result.audioBase64,
      contentType: result.contentType,
      provider: 'alibaba',
      voiceId,
      model: AlibabaProvider.VOICE_CLONE_MODEL
    };
  } catch (err) {
    throw new Error(`Alibaba speech synthesis error: ${err.message}`);
  }
}

// ────────────────────────────────────────────────────────────
// List / catalog
// ────────────────────────────────────────────────────────────

async function listVoicesHandler(apiKeys, provider = 'elevenlabs') {
  if (provider === 'alibaba') {
    if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
      throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
    }
    const alibaba = new AlibabaProvider(apiKeys.alibaba.api_key, apiKeys.alibaba.workspace_id);
    const voices = await alibaba.listClonedVoices();
    return {
      voices: voices.map(v => ({
        voice_id: v.voice,
        name: v.voice,
        language: v.language,
        created_at: v.gmt_create
      }))
    };
  }

  if (!apiKeys.elevenlabs?.api_key) {
    throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
  }
  const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
  const data = await elevenlabs.listVoices();
  return { voices: data.voices || [] };
}

function getModelCatalog(userTier) {
  return {
    providers: ['alibaba', 'elevenlabs'],
    models: {
      alibaba: [AlibabaProvider.VOICE_CLONE_MODEL],
      elevenlabs: ['instant-voice-cloning']
    },
    defaults: {
      alibaba: AlibabaProvider.VOICE_CLONE_MODEL,
      elevenlabs: 'instant-voice-cloning'
    },
    parameters: MODEL_PARAMETERS
  };
}

module.exports = {
  voiceCloneHandler,
  synthesizeHandler,
  listVoicesHandler,
  getModelCatalog,
  MODEL_PARAMETERS
};
