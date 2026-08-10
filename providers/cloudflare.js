// Cloudflare Workers AI provider wrapper
// Reference implementation for the image path: https://github.com/sanjayaidev/CloudflareImage
// Auth: Bearer API token scoped to an Account ID (dash.cloudflare.com > My Profile > API Tokens,
// "Workers AI" template — read access is enough).
//
// Free tier: 10,000 Neurons/day, shared across all models, no credit card required.
// Free models wired here:
//   - @cf/myshell-ai/melotts            (text-to-speech — this app's primary use of Cloudflare)
//   - @cf/black-forest-labs/flux-1-schnell (text-to-image — bonus, same free model PixazoLTX
//                                            also exposes, useful as a fallback image provider)

const BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';

const FREE_MODELS = {
  tts: ['@cf/myshell-ai/melotts'],
  image: ['@cf/black-forest-labs/flux-1-schnell'],
};

const MELOTTS_LANGS = ['en', 'es', 'fr', 'zh', 'ja', 'ko']; // per Cloudflare docs; 'en' is the safe default

class CloudflareProvider {
  constructor(apiToken, accountId) {
    if (!apiToken) throw new Error('Cloudflare API token is required');
    if (!accountId) throw new Error('Cloudflare Account ID is required');
    this.apiToken = apiToken;
    this.accountId = accountId;
  }

  static getFreeModels() {
    return FREE_MODELS;
  }

  _url(model) {
    return `${BASE_URL}/${this.accountId}/ai/run/${model}`;
  }

  _headers(contentType = 'application/json') {
    return {
      'Content-Type': contentType,
      Authorization: `Bearer ${this.apiToken}`,
    };
  }

  // text-to-speech via MeloTTS (@cf/myshell-ai/melotts) — free.
  // Returns { audioBase64, contentType } — an MP3, base64-encoded so it can
  // travel through JSON the same way the rest of this app's API responses do.
  async textToSpeech(text, options = {}) {
    if (!text || !text.trim()) throw new Error('text is required');
    const lang = options.lang || 'en';
    if (!MELOTTS_LANGS.includes(lang)) {
      throw new Error(`Unsupported MeloTTS language "${lang}". Supported: ${MELOTTS_LANGS.join(', ')}`);
    }

    const response = await fetch(this._url(FREE_MODELS.tts[0]), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ prompt: text, lang }),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const detail = errBody?.errors?.[0]?.message || `HTTP ${response.status}`;
      throw new Error(`Cloudflare MeloTTS error: ${detail}`);
    }

    // Success can come back as raw audio/mpeg bytes, or as JSON with a base64
    // `result.audio` field depending on the `Accept` negotiation — handle both.
    if (contentType.includes('audio/')) {
      const arrayBuffer = await response.arrayBuffer();
      return { audioBase64: Buffer.from(arrayBuffer).toString('base64'), contentType: 'audio/mpeg' };
    }

    const data = await response.json();
    if (data?.errors?.length) {
      throw new Error(`Cloudflare MeloTTS error: ${data.errors[0]?.message || 'unknown error'}`);
    }
    const audio = data?.result?.audio;
    if (!audio) throw new Error('Cloudflare MeloTTS returned no audio data');
    return { audioBase64: audio, contentType: 'audio/mpeg' };
  }

  // text-to-image via Flux 1 Schnell (@cf/black-forest-labs/flux-1-schnell) — free.
  // params: { prompt, num_steps<=8, seed }
  // NOTE: per Cloudflare's documented schema, this model only accepts
  // `prompt`, `steps`, and `seed`. It does NOT accept width/height —
  // output resolution is fixed by the model. Two bugs fixed here:
  //   1. the request body used to send `num_steps`, but Cloudflare's API
  //      field is `steps` — the wrong key meant every request silently
  //      fell back to the API's own default (4) regardless of what the
  //      user picked in the UI.
  //   2. width/height were being sent even though Cloudflare doesn't
  //      accept them for this model; unknown fields are silently
  //      dropped, so those two UI controls did nothing either. They're
  //      no longer forwarded — see modules/text-to-image.js for the
  //      matching schema fix that removes them from the Cloudflare UI.
  // Returns { imageDataUrl } — base64 JPEG as a data: URL, ready to drop into <img src>.
  async textToImage(params = {}) {
    if (!params.prompt) throw new Error('prompt is required');

    const body = {
      prompt: params.prompt,
      steps: Math.min(Math.max(parseInt(params.num_steps) || 4, 1), 8),
    };
    if (params.seed !== undefined) body.seed = params.seed;

    const response = await fetch(this._url(FREE_MODELS.image[0]), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const detail = errBody?.errors?.[0]?.message || `HTTP ${response.status}`;
      throw new Error(`Cloudflare Flux 1 Schnell error: ${detail}`);
    }

    const data = await response.json();
    if (data?.errors?.length) {
      throw new Error(`Cloudflare Flux 1 Schnell error: ${data.errors[0]?.message || 'unknown error'}`);
    }
    const b64 = data?.result?.image;
    if (!b64) throw new Error('Cloudflare Flux 1 Schnell returned no image data');
    return { imageDataUrl: `data:image/jpeg;base64,${b64}` };
  }

  // Lightweight connectivity check for Profile > API Keys > Test.
  async testConnection() {
    return this.textToSpeech('connection test', { lang: 'en' });
  }
}

module.exports = CloudflareProvider;
