// modules/image-to-image.js
// Image-to-Image (edit) module — implemented via Alibaba's qwen-image-edit
// model family (see providers/alibaba-models.js "Image Edit models").
// Pixazo has no image-to-image endpoint yet, so it stays unsupported there
// and callers are pointed at the Alibaba provider instead.

const AlibabaProvider = require('../providers/alibaba');
const alibabaModels = require('../providers/alibaba-models');

// Get edit models from alibaba-models.js
const ALIBABA_EDIT_MODELS = alibabaModels.getModelsByCategory('vision').filter(m => 
  m.startsWith('qwen-image-edit')
);

const DEFAULT_ALIBABA_EDIT_MODEL = 'qwen-image-edit-plus';

// Parameters supported by each provider's models
// Based on https://github.com/sanjayaidev/AlibabaCloud - image edit uses prompt + image
const MODEL_PARAMETERS = {
  'alibaba': {
    size: {
      type: 'select',
      options: ['1024*1024', '1280*720', '720*1280', '1536*1024', '1024*1536'],
      default: '1024*1024',
      label: 'Size'
    },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
  },
  'pixazo': {
    // Pixazo has no image-to-image endpoint yet — kept here only so the UI
    // can show a disabled option with an explanatory note.
    prompt: { type: 'text', default: '', label: 'Edit Instruction' },
    strength: { type: 'range', min: 0, max: 1, default: 0.75, step: 0.05, label: 'Strength' },
  }
};

async function imageToImageHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    image_url,
    provider = 'alibaba',
    model: requestedModel,
    width,
    height,
    seed,
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Edit instruction is required for image editing');
  }

  if (!image_url || !image_url.trim()) {
    throw new Error('Source image URL is required for image editing');
  }

  // Pixazo doesn't currently support image-to-image.
  if (provider === 'pixazo') {
    throw new Error('Pixazo does not currently support image-to-image editing. Please use the Alibaba provider for this feature.');
  }

  if (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }

  const model = ALIBABA_EDIT_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_ALIBABA_EDIT_MODEL;

  const alibaba = new AlibabaProvider(
    apiKeys.alibaba.api_key,
    apiKeys.alibaba.workspace_id
  );

  let imageUrl, imageDataUrl;

  try {
    const size = (width && height) ? `${parseInt(width)}*${parseInt(height)}` : undefined;
    const result = await alibaba.imageEdit(prompt, image_url, {
      model,
      size,
      seed: seed ? parseInt(seed) : undefined,
    });

    const urls = result._imageUrls || [];
    if (urls.length === 0) {
      const errorMsg = result?.output?.text || result?.message || 'No edited image returned';
      throw new Error(errorMsg);
    }

    imageUrl = urls[0];
    imageDataUrl = null;
  } catch (err) {
    throw new Error(`Alibaba Image Edit error: ${err.message}`);
  }

  return {
    imageUrl,
    imageDataUrl,
    provider: 'alibaba',
    model,
    parameters: { prompt, width, height, seed }
  };
}

function getModelCatalog(userTier) {
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);

  return {
    providers: ['alibaba', 'pixazo'],
    models: {
      alibaba: isPaid ? ALIBABA_EDIT_MODELS : [],
      pixazo: []
    },
    defaults: {
      alibaba: DEFAULT_ALIBABA_EDIT_MODEL,
      pixazo: null
    },
    parameters: MODEL_PARAMETERS,
    note: 'Image-to-image editing runs on Alibaba (qwen-image-edit). Pixazo does not offer this yet.'
  };
}

module.exports = {
  imageToImageHandler,
  getModelCatalog,
  MODEL_PARAMETERS,
  ALIBABA_EDIT_MODELS,
  DEFAULT_ALIBABA_EDIT_MODEL
};
