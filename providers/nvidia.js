// NVIDIA API wrapper for use by multiple modules
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

class NvidiaProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async chatCompletion(messages, options = {}) {
    const {
      model = 'meta/llama-3.1-70b-instruct',
      temperature = 0.7,
      max_tokens = 2048,
      stream = false
    } = options;

    const payload = {
      model,
      messages,
      temperature,
      max_tokens,
      top_p: 1,
      stream
    };

    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NVIDIA API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async listModels() {
    const response = await fetch(`${NVIDIA_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    return response.json();
  }
}

module.exports = NvidiaProvider;