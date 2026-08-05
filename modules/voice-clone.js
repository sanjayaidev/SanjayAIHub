// modules/voice-clone.js
// Voice Cloning module — ElevenLabs Instant Voice Cloning
// (providers/elevenlabs.js already implements cloneVoice/listVoices; this
// module wires it into the app's request/response shape.)
//
// Audio samples travel as base64 in the JSON body (data URLs or raw base64),
// same convention this app already uses for imageDataUrl / audioBase64, so
// no multipart/multer plumbing is needed on top of the existing JSON API.

const ElevenLabsProvider = require('../providers/elevenlabs');

const MODEL_PARAMETERS = {
  'elevenlabs': {
    name: { type: 'text', default: '', label: 'Voice Name' },
    description: { type: 'text', default: '', label: 'Description (optional)' },
  }
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

async function voiceCloneHandler(requestBody, apiKeys, userId) {
  const {
    name,
    description,
    samples, // array of base64 / data-url strings
  } = requestBody;

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

async function listVoicesHandler(apiKeys) {
  if (!apiKeys.elevenlabs?.api_key) {
    throw new Error('ElevenLabs API key not configured. Add it in Profile > API Keys.');
  }
  const elevenlabs = new ElevenLabsProvider(apiKeys.elevenlabs.api_key);
  const data = await elevenlabs.listVoices();
  return { voices: data.voices || [] };
}

function getModelCatalog(userTier) {
  return {
    providers: ['elevenlabs'],
    models: {
      elevenlabs: ['instant-voice-cloning']
    },
    defaults: {
      elevenlabs: 'instant-voice-cloning'
    },
    parameters: MODEL_PARAMETERS
  };
}

module.exports = {
  voiceCloneHandler,
  listVoicesHandler,
  getModelCatalog,
  MODEL_PARAMETERS
};
