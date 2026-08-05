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
    } = options;

    if (!model) throw new Error('Alibaba chatCompletion requires a model');

    const payload = { model, messages, temperature, max_tokens, top_p, stream };

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

  // Async video generation (Wan T2V/I2V models). DashScope-style: submit a
  // task, then poll it with checkVideoTask(). Mirrors the async pattern the
  // rest of this app already uses for Pixazo video jobs.
  // Returns { output: { task_id, task_status } }.
  async videoGeneration(prompt, options = {}) {
    const { model, image_url, size, duration, seed, negative_prompt } = options;
    if (!model) throw new Error('Alibaba videoGeneration requires a model');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const input = { prompt };
    if (image_url) input.img_url = image_url;
    if (negative_prompt) input.negative_prompt = negative_prompt;

    const parameters = {};
    if (size) parameters.size = size;
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

  // Poll an async video task submitted via videoGeneration().
  // Returns { output: { task_status, video_url, ... } }.
  // task_status: PENDING | RUNNING | SUCCEEDED | FAILED
  async checkVideoTask(taskId) {
    if (!taskId) throw new Error('taskId is required');

    const response = await fetch(`${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alibaba video task status error (${response.status}): ${errorText}`);
    }

    return response.json();
  }
}

module.exports = AlibabaProvider;