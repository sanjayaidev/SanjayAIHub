// Pixazo Gateway provider wrapper
// Docs / reference implementation: https://github.com/sanjayaidev/PixazoLTX
// Auth: "Ocp-Apim-Subscription-Key" header (Azure APIM-style gateway)
//
// Free models on Pixazo as of this writing:
//   - LTX 2.3            (video: text-to-video, image-to-video, video-to-video)
//   - Flux 1 Schnell     (image: text-to-image — synchronous, no polling)
//   - Ace Step           (audio: text-to-audio, music generation)

const GATEWAY = 'https://gateway.pixazo.ai';

// Free video models, keyed by the mode the app exposes.
const FREE_VIDEO_MODES = {
  'text-to-video': { model: 'ltx-2.3', path: '/ltx-video/v1/text-to-video' },
  'image-to-video': { model: 'ltx-2.3', path: '/ltx-video/v1/image-to-video' },
  'video-to-video': { model: 'ltx-2.3', path: '/ltx-video/v1/video-to-video' },
};

const FREE_IMAGE_MODEL = { model: 'flux-1-schnell', path: '/flux-1-schnell/v1/getData' };

// Free audio model - Ace Step
const FREE_AUDIO_MODEL = { model: 'ace-step', path: '/tracks/v1/generate' };

class PixazoProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Pixazo API key is required');
    this.apiKey = apiKey;
  }

  static getFreeModels() {
    return {
      video: Object.keys(FREE_VIDEO_MODES).map((mode) => ({ mode, model: FREE_VIDEO_MODES[mode].model })),
      image: [FREE_IMAGE_MODEL.model],
      audio: [FREE_AUDIO_MODEL.model],
    };
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.apiKey,
    };
  }

  // Strip empty/undefined fields so we only send what was actually set.
  _clean(body) {
    const out = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  }

  // mode: 'text-to-video' | 'image-to-video' | 'video-to-video'
  // params: { prompt, aspect, frame_rate, width, height, num_frames, seed,
  //           enhance_prompt, image_url (i2v), video_url + strength (v2v) }
  // Async — returns { request_id, status, ... }. Poll with checkStatus().
  async generateVideo(mode, params = {}) {
    const config = FREE_VIDEO_MODES[mode];
    if (!config) {
      throw new Error(`Unknown Pixazo video mode "${mode}". Supported: ${Object.keys(FREE_VIDEO_MODES).join(', ')}`);
    }
    if (!params.prompt) throw new Error('prompt is required');
    if (mode === 'image-to-video' && !params.image_url) throw new Error('image_url is required for image-to-video');
    if (mode === 'video-to-video' && !params.video_url) throw new Error('video_url is required for video-to-video');

    const response = await fetch(`${GATEWAY}${config.path}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._clean(params)),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Pixazo ${config.model} error (${response.status}): ${data.message || data.error || 'request failed'}`);
    }
    return data; // { request_id, status, ... }
  }

  // Flux 1 Schnell — free, synchronous (no polling). Response has the
  // finished image URL directly as `output`.
  // params: { prompt, width, height, num_steps (max 8), seed }
  async generateImage(params = {}) {
    if (!params.prompt) throw new Error('prompt is required');

    const response = await fetch(`${GATEWAY}${FREE_IMAGE_MODEL.path}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._clean(params)),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !data.output) {
      throw new Error(`Pixazo Flux 1 Schnell error (${response.status}): ${data.message || data.error || 'no image returned'}`);
    }
    return data; // { output: '<image_url>', ... }
  }

  // Ace Step — free audio generation
  // params: { prompt, lyrics, instrumental, duration, bpm, infer_steps, guidance_scale, seed }
  // Async — returns { request_id, status, ... }. Poll with checkStatus().
  async generateAudio(params = {}) {
    if (!params.prompt) throw new Error('prompt is required');

    const response = await fetch(`${GATEWAY}${FREE_AUDIO_MODEL.path}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._clean(params)),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Pixazo Ace Step error (${response.status}): ${data.message || data.error || 'request failed'}`);
    }
    return data; // { request_id, status, ... }
  }

  // Poll an async video job. status: QUEUED | PROCESSING | COMPLETED | FAILED | ERROR
  // On COMPLETED: data.output.media_url[0] is the finished video URL.
  async checkStatus(requestId) {
    if (!requestId) throw new Error('requestId is required');

    const response = await fetch(`${GATEWAY}/v2/requests/status/${encodeURIComponent(requestId)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Pixazo status check error (${response.status}): ${data.message || data.error || 'request failed'}`);
    }
    return data;
  }

  // Lightweight connectivity check for Profile > API Keys > Test.
  // Pixazo has no dedicated "ping" endpoint, so this submits the cheapest
  // possible real request — a 1-step Flux 1 Schnell 64x64 image.
  async testConnection() {
    return this.generateImage({ prompt: 'connectivity test', width: 64, height: 64, num_steps: 1 });
  }
}

module.exports = PixazoProvider;