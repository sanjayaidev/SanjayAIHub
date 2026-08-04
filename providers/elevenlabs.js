// ElevenLabs provider wrapper
// Auth: 'xi-api-key' header.
//
// Free plan (10,000 credits/mo, no card) gives access to every TTS model below —
// they only differ in credit cost per character and output quality/latency, not
// plan gating. Voice Design (synthetic voices from a text description) is free
// up to 3 slots; full instant voice cloning from an audio sample is also callable
// here, but ElevenLabs may restrict it below Starter — the API will say so if it does.

const BASE_URL = 'https://api.elevenlabs.io';

// All TTS models usable on the Free plan, credits differ per character:
//   Multilingual v2 / v3      -> 1 credit/char   (highest quality & emotional range)
//   Flash v2.5 / Turbo v2.5   -> ~0.5 credit/char (fast, multilingual)
//   Flash v2 / Turbo v2       -> ~0.5 credit/char (fast, English-only)
const FREE_TTS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_flash_v2',
  'eleven_turbo_v2',
  'eleven_v3',
];

const DEFAULT_MODEL = 'eleven_flash_v2_5';
// ElevenLabs' built-in default voice ("Rachel") — always present on every account.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

class ElevenLabsProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('ElevenLabs API key is required');
    this.apiKey = apiKey;
  }

  static getFreeModels() {
    return { tts: FREE_TTS_MODELS, default: DEFAULT_MODEL };
  }

  _headers(extra = {}) {
    return { 'xi-api-key': this.apiKey, ...extra };
  }

  // text-to-speech. voiceId defaults to the built-in "Rachel" voice.
  // Returns { audioBase64, contentType } (MP3).
  async textToSpeech(text, voiceId = DEFAULT_VOICE_ID, options = {}) {
    if (!text || !text.trim()) throw new Error('text is required');
    const model_id = options.model_id || DEFAULT_MODEL;
    if (!FREE_TTS_MODELS.includes(model_id)) {
      throw new Error(`Unknown ElevenLabs model "${model_id}". Available: ${FREE_TTS_MODELS.join(', ')}`);
    }

    const response = await fetch(`${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json', Accept: 'audio/mpeg' }),
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: options.voice_settings || { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`ElevenLabs TTS error (${response.status}): ${detail.detail?.message || detail.detail || 'request failed'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return { audioBase64: Buffer.from(arrayBuffer).toString('base64'), contentType: 'audio/mpeg' };
  }

  // List voices available to this account (built-in + any cloned/designed voices).
  async listVoices() {
    const response = await fetch(`${BASE_URL}/v2/voices`, { headers: this._headers() });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`ElevenLabs list voices error (${response.status}): ${detail.detail?.message || detail.detail || 'request failed'}`);
    }
    return response.json();
  }

  // Instant Voice Cloning from one or more audio samples.
  // files: array of { buffer, filename, mimetype } (e.g. from multer memory storage).
  // Note: IVC may be gated to Starter+ on ElevenLabs' side even though the
  // endpoint is called the same way — surface their error message as-is.
  async cloneVoice(name, files = [], options = {}) {
    if (!name || !name.trim()) throw new Error('Voice name is required');
    if (!files.length) throw new Error('At least one audio sample is required');

    const form = new FormData();
    form.append('name', name.trim());
    if (options.description) form.append('description', options.description);
    for (const f of files) {
      form.append('files', new Blob([f.buffer], { type: f.mimetype || 'audio/mpeg' }), f.filename || 'sample.mp3');
    }

    const response = await fetch(`${BASE_URL}/v1/voices/add`, {
      method: 'POST',
      headers: this._headers(), // do NOT set Content-Type — FormData sets the multipart boundary
      body: form,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`ElevenLabs voice cloning error (${response.status}): ${data.detail?.message || data.detail || 'request failed'}`);
    }
    return data; // { voice_id, ... }
  }

  // Lightweight connectivity check for Profile > API Keys > Test.
  // /v1/user is a free, no-credit-cost endpoint — safer than burning TTS credits.
  async testConnection() {
    const response = await fetch(`${BASE_URL}/v1/user`, { headers: this._headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`ElevenLabs connection error (${response.status}): ${data.detail?.message || data.detail || 'invalid key'}`);
    }
    return data;
  }
}

module.exports = ElevenLabsProvider;
