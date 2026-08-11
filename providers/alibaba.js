// Alibaba Cloud Model Studio (DashScope) provider wrapper
// Chat uses the OpenAI-compatible endpoint, scoped to the user's workspace:
//   https://{workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions
// Image generation/editing (unified as of Qwen-Image 3.0, Jul 2026) and
// video use the native DashScope endpoints:
//   https://{workspace_id}.{region}.maas.aliyuncs.com/api/v1/...

const DEFAULT_REGION = 'ap-southeast-1'; // Singapore

class AlibabaProvider {
  constructor(apiKey, workspaceId, region = DEFAULT_REGION) {
    if (!apiKey) throw new Error('Alibaba API key is required');
    if (!workspaceId) throw new Error('Alibaba workspace_id is required');
    this.apiKey = apiKey;
    this.workspaceId = workspaceId;
    this.baseUrl = `https://${workspaceId}.${region}.maas.aliyuncs.com`;
    this.chatBaseUrl = `${this.baseUrl}/compatible-mode/v1`;
  }

  // messages: [{ role, content }] where content can be a string
  // OR (for vision models) an array of { type: 'text'|'image_url', text?, image_url? }
  async chatCompletion(messages, options = {}) {
    const {
      model,
      temperature = 0.7,
      max_tokens = 2048,
      top_p = 1,
      stream = false,
      // Hybrid reasoning models hosted here (deepseek-v3.2 and later,
      // qwen3-*) think by default. Callers that need a direct, immediately
      // parseable answer (e.g. strict-JSON output) should pass
      // enable_thinking: false, or the reasoning trace can eat the whole
      // max_tokens budget before the model ever emits its final answer,
      // leaving `message.content` empty or truncated. Omit this option
      // entirely to leave the model's own default behavior untouched.
      enable_thinking,
    } = options;

    if (!model) throw new Error('Alibaba chatCompletion requires a model');

    const payload = { model, messages, temperature, max_tokens, top_p, stream };
    if (enable_thinking !== undefined) {
      payload.enable_thinking = enable_thinking;
    }

    const response = await fetch(`${this.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        detail = JSON.parse(errorText).error?.message || errorText;
      } catch (_) {}
      throw new Error(`Alibaba API error (${response.status}): ${detail}`);
    }

    return response.json();
  }

  // Text-to-image AND image-to-image (editing) via the DashScope
  // multimodal-generation endpoint. As of the Qwen-Image 3.0 API (Jul 2026),
  // both T2I and I2I go through the SAME endpoint/shape — the only
  // difference is whether the message `content` array includes 1-3
  // `{ image }` entries ahead of the required single `{ text }` entry.
  // Docs: https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
  //
  // Request:  POST {baseUrl}/api/v1/services/aigc/multimodal-generation/generation
  //   { model, input: { messages: [{ role: 'user', content: [...] }] }, parameters }
  // Response (success):
  //   { output: { choices: [{ finish_reason, message: { role, content: [{ image: url }, ...] } }] },
  //     usage: { width, height, image_count }, request_id }
  // Response (error): { request_id, code, message }
  //
  // `images`: optional array of 1-3 image URLs/base64 data URIs for I2I.
  // Leave empty/omitted for plain text-to-image.
  // Returns the raw DashScope JSON, plus a convenience `_imageUrls` array.
  async imageGeneration(prompt, options = {}) {
    const {
      model,
      images = [],
      size,
      n = 1,
      seed,
      negative_prompt,
      prompt_extend = true,
      watermark = false,
      thinking_mode,
      enable_sequential,
    } = options;

    if (!model) throw new Error('Alibaba imageGeneration requires a model');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');
    if (images.length > 3) throw new Error('At most 3 reference images are supported for image-to-image');

    const content = images.filter(Boolean).map((img) => ({ image: img }));
    content.push({ text: prompt });

    const parameters = { prompt_extend: !!prompt_extend, watermark: !!watermark };
    if (size) parameters.size = size;
    if (n !== undefined && n !== null) parameters.n = parseInt(n) || 1;
    if (negative_prompt && negative_prompt.trim()) parameters.negative_prompt = negative_prompt;
    if (seed !== undefined && seed !== null && seed !== '') parameters.seed = parseInt(seed);
    if (thinking_mode !== undefined) parameters.thinking_mode = !!thinking_mode;
    if (enable_sequential !== undefined) parameters.enable_sequential = !!enable_sequential;

    const payload = {
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters,
    };

    const response = await fetch(`${this.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.code) {
      const detail = data.message || data.output?.text || `HTTP ${response.status}`;
      throw new Error(`Alibaba image generation error (${data.code || response.status}): ${detail}`);
    }

    // Collect generated image URLs from every choice's content array.
    const urls = [];
    for (const choice of data?.output?.choices || []) {
      for (const item of choice?.message?.content || []) {
        if (item?.image) urls.push(item.image);
      }
    }

    // Fallback for any older/async model still using the legacy shape
    // ({ output: { results: [{ url }] } } or a task_id to poll).
    if (urls.length === 0 && Array.isArray(data?.output?.results)) {
      for (const r of data.output.results) if (r?.url) urls.push(r.url);
    }
    const taskStatus = data?.output?.task_status;
    if (taskStatus === 'PENDING' || taskStatus === 'RUNNING') {
      data._async = true;
      data._taskId = data.output.task_id;
    }

    data._imageUrls = urls;
    return data;
  }

  // Backward-compatible wrapper: image editing is now just imageGeneration()
  // with one reference image attached. Kept so existing callers (and
  // modules/image-to-image.js) don't need to change their call shape.
  // `imageUrl` may be a single URL/base64 string, or an array of up to 3.
  async imageEdit(prompt, imageUrl, options = {}) {
    if (!prompt || !prompt.trim()) throw new Error('prompt (edit instruction) is required');
    if (!imageUrl) throw new Error('imageUrl is required');

    const images = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
    return this.imageGeneration(prompt, { ...options, images });
  }

  // Async video generation (Wan T2V/I2V/R2V + HappyHorse models). DashScope-
  // style: submit a task, then poll it with checkVideoTask(). Mirrors the
  // async pattern the rest of this app already uses for Pixazo video jobs.
  //
  // As of the current video-synthesis API, source assets go in a single
  // `input.media` array of `{ type, url }` entries instead of a flat
  // `img_url` field, and sizing is expressed as a `resolution` preset
  // (e.g. "480P"/"720P"/"1080P") — T2V models additionally take a `ratio`
  // (e.g. "16:9") since there's no source frame to infer aspect from.
  // Docs: https://www.alibabacloud.com/help/en/model-studio/video-generation-wan
  //
  // `media` types in use: 'first_frame', 'last_frame', 'driving_audio',
  // 'reference_image' (R2V). `image_url` is kept as a back-compat shortcut
  // for the common single-image I2V case — it's converted into a
  // `first_frame` media entry if `media` doesn't already define one.
  //
  // Returns { output: { task_id, task_status } }.
  async videoGeneration(prompt, options = {}) {
    const {
      model,
      media = [],
      image_url,
      resolution,
      ratio,
      duration,
      seed,
      negative_prompt,
      prompt_extend = true,
      watermark = true,
    } = options;
    if (!model) throw new Error('Alibaba videoGeneration requires a model');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const mediaList = media.filter(Boolean).map((m) => ({ ...m }));
    if (image_url && !mediaList.some((m) => m.type === 'first_frame')) {
      mediaList.unshift({ type: 'first_frame', url: image_url });
    }

    const input = { prompt };
    if (mediaList.length > 0) input.media = mediaList;
    if (negative_prompt) input.negative_prompt = negative_prompt;

    const parameters = { prompt_extend: !!prompt_extend, watermark: !!watermark };
    if (resolution) parameters.resolution = resolution;
    if (ratio) parameters.ratio = ratio;
    if (duration) parameters.duration = duration;
    if (seed !== undefined && seed !== null) parameters.seed = seed;

    const response = await fetch(`${this.baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({ model, input, parameters }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        detail = JSON.parse(errorText).error?.message || errorText;
      } catch (_) {}
      throw new Error(`Alibaba video generation error (${response.status}): ${detail}`);
    }

    return response.json();
  }

  // Poll ANY DashScope async task — video-synthesis, and now also the
  // legacy image-synthesis tasks submitted via imageSynthesisLegacy().
  // Both submit to different endpoints but share this same generic
  // /api/v1/tasks/{id} polling endpoint.
  // Returns { output: { task_status, video_url | results, ... } }.
  // task_status: PENDING | RUNNING | SUCCEEDED | FAILED
  async checkTask(taskId) {
    if (!taskId) throw new Error('taskId is required');

    const response = await fetch(`${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alibaba task status error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  // Back-compat alias — existing callers use checkVideoTask().
  async checkVideoTask(taskId) {
    return this.checkTask(taskId);
  }

  // Legacy Wan text-to-image models (wan2.1-t2i-turbo, wan2.1-t2i-plus,
  // wan2.2-t2i-flash, wan2.2-t2i-plus, wan2.5-t2i-preview) live on
  // DashScope's OLDER image-synthesis API, not the same sync
  // multimodal-generation endpoint used by imageGeneration() for
  // Qwen-Image and the newer wan2.6-t2i/wan2.7-image. Calling these
  // models through the wrong endpoint produces a nonsensical
  // "url error, please check url" response — confirmed via
  // scripts/test-endpoints.js on 2026-08-10. See LEGACY_IMAGE_SYNTHESIS_MODELS
  // at the bottom of this file for the exact model list this applies to.
  //
  // This is async like videoGeneration() — submit here, then poll with
  // checkTask(). On SUCCEEDED, output.results is an array of { url }.
  // Docs: https://www.alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference
  async imageSynthesisLegacy(prompt, options = {}) {
    const {
      model,
      size,
      n = 1,
      seed,
      negative_prompt,
      prompt_extend = true,
      watermark = false,
    } = options;

    if (!model) throw new Error('Alibaba imageSynthesisLegacy requires a model');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const input = { prompt };
    if (negative_prompt && negative_prompt.trim()) input.negative_prompt = negative_prompt;

    const parameters = { prompt_extend: !!prompt_extend, watermark: !!watermark, n: parseInt(n) || 1 };
    if (size) parameters.size = size;
    if (seed !== undefined && seed !== null && seed !== '') parameters.seed = parseInt(seed);

    const response = await fetch(`${this.baseUrl}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({ model, input, parameters }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        detail = JSON.parse(errorText).error?.message || errorText;
      } catch (_) {}
      throw new Error(`Alibaba legacy image synthesis error (${response.status}): ${detail}`);
    }

    return response.json(); // { output: { task_id, task_status } }
  }

  // ────────────────────────────────────────────────────────────
  // Voice cloning (enrollment) + speech synthesis with a cloned voice.
  //
  // IMPORTANT: use the non-realtime VC model here. The "-realtime" variant
  // (e.g. qwen3-tts-vc-realtime-*) only speaks the websocket/realtime
  // protocol - calling it over this plain HTTP endpoint returns
  // {"code":"InvalidParameter","message":"Invalid message type: "}.
  // Docs: https://www.alibabacloud.com/help/en/model-studio/voice-cloning-user-guide
  //       https://www.alibabacloud.com/help/en/model-studio/nls-tts-user-guide
  get _voiceCustomizationUrl() {
    return `${this.baseUrl}/api/v1/services/audio/tts/customization`;
  }

  get _ttsGenerationUrl() {
    return `${this.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
  }

  // Enroll a new cloned voice from a short audio sample.
  // `audioDataUrl`: a "data:<mime>;base64,<...>" string (bare base64 is
  // also accepted and treated as audio/wav).
  // `preferredName` is sanitized to satisfy the API's constraints
  // (letters/numbers/underscore, must start with a letter, max 16 chars)
  // rather than surfacing a cryptic InvalidParameter error.
  async cloneVoice(preferredName, audioDataUrl, language = 'en') {
    if (!audioDataUrl) throw new Error('audioDataUrl is required');

    let cleaned = String(preferredName || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (cleaned.length > 0 && !/^[a-zA-Z]/.test(cleaned)) cleaned = 'voice_' + cleaned;
    if (cleaned.length > 16) cleaned = cleaned.substring(0, 16);
    if (!cleaned) cleaned = 'voice_' + Date.now().toString().slice(-10);

    const audio = audioDataUrl.startsWith('data:')
      ? audioDataUrl
      : `data:audio/wav;base64,${audioDataUrl}`;

    const payload = {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model: AlibabaProvider.VOICE_CLONE_MODEL,
        preferred_name: cleaned,
        audio: { data: audio },
        language,
      },
    };

    const response = await fetch(this._voiceCustomizationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code) {
      throw new Error(`Alibaba voice cloning error (${data.code || response.status}): ${data.message || 'request failed'}`);
    }

    return { voiceId: data.output.voice, voiceName: cleaned };
  }

  // List voices previously cloned on this workspace.
  async listClonedVoices() {
    const payload = { model: 'qwen-voice-enrollment', input: { action: 'list', page_size: 50, page_index: 0 } };
    const response = await fetch(this._voiceCustomizationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code) {
      throw new Error(`Alibaba list voices error (${data.code || response.status}): ${data.message || 'request failed'}`);
    }
    return data.output?.voice_list || [];
  }

  // Delete a cloned voice.
  async deleteClonedVoice(voiceId) {
    if (!voiceId) throw new Error('voiceId is required');
    const payload = { model: 'qwen-voice-enrollment', input: { action: 'delete', voice: voiceId } };
    const response = await fetch(this._voiceCustomizationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code) {
      throw new Error(`Alibaba delete voice error (${data.code || response.status}): ${data.message || 'request failed'}`);
    }
    return true;
  }

  // Synthesize speech with a previously cloned voice.
  // Returns { audioBase64, contentType }.
  async synthesizeWithClonedVoice(text, voiceId, language = 'English') {
    if (!text || !text.trim()) throw new Error('text is required');
    if (!voiceId) throw new Error('voiceId is required');

    const payload = {
      model: AlibabaProvider.VOICE_CLONE_MODEL,
      input: { text, voice: voiceId, language_type: language },
    };

    const response = await fetch(this._ttsGenerationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    // Note: this endpoint does NOT return a top-level status_code on
    // success - only output/usage/request_id. Success is the HTTP status
    // (checked via response.ok) plus output.audio.url being present.
    if (!response.ok || data.code || !data.output?.audio?.url) {
      throw new Error(`Alibaba speech synthesis error (${data.code || response.status}): ${data.message || 'no audio returned'}`);
    }

    const audioResponse = await fetch(data.output.audio.url);
    if (!audioResponse.ok) throw new Error(`Failed to download synthesized audio: HTTP ${audioResponse.status}`);
    const arrayBuffer = await audioResponse.arrayBuffer();
    const contentType = audioResponse.headers.get('content-type') || 'audio/wav';

    return { audioBase64: Buffer.from(arrayBuffer).toString('base64'), contentType };
  }
}

// The only VC model callable over the plain HTTP multimodal-generation
// endpoint (see notes on cloneVoice/synthesizeWithClonedVoice above).
AlibabaProvider.VOICE_CLONE_MODEL = 'qwen3-tts-vc-2026-01-22';

// Legacy Wan t2i models that must go through imageSynthesisLegacy()
// instead of imageGeneration() — see the comment on that method for why.
// Callers (modules/text-to-image.js, scripts/test-endpoints.js) check
// this list to route correctly.
AlibabaProvider.LEGACY_IMAGE_SYNTHESIS_MODELS = [
  'wan2.1-t2i-turbo',
  'wan2.1-t2i-plus',
  'wan2.2-t2i-flash',
  'wan2.2-t2i-plus',
  'wan2.5-t2i-preview',
];

module.exports = AlibabaProvider;