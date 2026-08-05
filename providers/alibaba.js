// Alibaba Cloud Model Studio (DashScope) provider wrapper
// Uses the OpenAI-compatible endpoint, scoped to the user's workspace.
// Docs pattern: https://{workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions

const DEFAULT_REGION = 'ap-southeast-1'; // Singapore

class AlibabaProvider {
  constructor(apiKey, workspaceId, region = DEFAULT_REGION) {
    if (!apiKey) throw new Error('Alibaba API key is required');
    if (!workspaceId) throw new Error('Alibaba workspace_id is required');
    this.apiKey = apiKey;
    this.workspaceId = workspaceId;
    this.baseUrl = `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`;
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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

  // Text-to-image via the OpenAI-compatible images endpoint. Works with the
  // synchronous Qwen-Image family (qwen-image, qwen-image-2.0, qwen-image-max,
  // qwen-image-plus) as well as the Wan T2I models.
  // Returns { data: [{ url }] } (OpenAI images.generate shape).
  async imageGeneration(prompt, options = {}) {
    const { model, size = '1024x1024', n = 1, seed, negative_prompt } = options;
    if (!model) throw new Error('Alibaba imageGeneration requires a model');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const payload = { model, prompt, n, size };
    if (seed !== undefined && seed !== null) payload.seed = seed;
    if (negative_prompt) payload.negative_prompt = negative_prompt;

    const response = await fetch(`${this.baseUrl}/images/generations`, {
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
      throw new Error(`Alibaba image generation error (${response.status}): ${detail}`);
    }

    return response.json();
  }

  // Image editing via the qwen-image-edit model family. Takes a source image
  // URL plus an edit instruction and returns an edited image.
  // Returns { data: [{ url }] } (same shape as imageGeneration).
  async imageEdit(prompt, imageUrl, options = {}) {
    const { model = 'qwen-image-edit-plus', size, seed, n = 1 } = options;
    if (!prompt || !prompt.trim()) throw new Error('prompt (edit instruction) is required');
    if (!imageUrl || !imageUrl.trim()) throw new Error('imageUrl is required');

    const payload = { model, prompt, image: imageUrl, n };
    if (size) payload.size = size;
    if (seed !== undefined && seed !== null) payload.seed = seed;

    const response = await fetch(`${this.baseUrl}/images/edits`, {
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
      throw new Error(`Alibaba image edit error (${response.status}): ${detail}`);
    }

    return response.json();
  }
}

module.exports = AlibabaProvider;
