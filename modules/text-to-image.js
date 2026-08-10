// modules/text-to-image.js
// Text-to-Image module supporting multiple providers (Alibaba, Pixazo, Cloudflare)
// with model-specific parameters.
//
// UI contract: every parameter below is a `select`, `range`, or `checkbox`
// field — never free-text number entry. The frontend renders controls
// straight from PARAM_SCHEMAS (see getModelCatalog()) so each model only
// shows the knobs it actually supports.

const AlibabaProvider = require('../providers/alibaba');
const PixazoProvider = require('../providers/pixazo');
const CloudflareProvider = require('../providers/cloudflare');

// ── Provider model lists ────────────────────────────────────────────────
const ALIBABA_IMAGE_MODELS = [
  'qwen-image-3.0-pro', // unified T2I + I2I, limited preview (Jul 2026)
  'qwen-image',
  'qwen-image-2.0',
  'qwen-image-max',
  'qwen-image-plus',
  'wan2.6-t2i',
  'wan2.7-image-pro',
];

const PIXAZO_IMAGE_MODEL = 'flux-1-schnell';
const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// ── Alibaba size presets ────────────────────────────────────────────────
// qwen-image-3.0-pro accepts any "W*H" with 512*512 <= W*H <= 2048*2048
// (or omit `size` to let the model choose). Older Qwen-Image models are
// restricted to a fixed, verified set of sizes.
const ALIBABA_SIZE_OPTIONS_3_0 = [
  { value: '', label: 'Auto (model decides)' },
  { value: '1024*1024', label: 'Square (1024×1024)' },
  { value: '1328*1328', label: 'Square (1328×1328)' },
  { value: '1664*928', label: 'Landscape 16:9 (1664×928)' },
  { value: '1472*1104', label: 'Landscape 4:3 (1472×1104)' },
  { value: '1104*1472', label: 'Portrait 3:4 (1104×1472)' },
  { value: '928*1664', label: 'Portrait 9:16 (928×1664)' },
  { value: '2048*2048', label: 'Square Max (2048×2048)' },
];

const ALIBABA_SIZE_OPTIONS_LEGACY = [
  { value: '1328*1328', label: 'Square (1328×1328)' },
  { value: '1664*928', label: 'Landscape 16:9 (1664×928)' },
  { value: '1472*1104', label: 'Landscape 4:3 (1472×1104)' },
  { value: '1104*1472', label: 'Portrait 3:4 (1104×1472)' },
  { value: '928*1664', label: 'Portrait 9:16 (928×1664)' },
];

const ALIBABA_VALID_SIZES = [
  '1024*1024', '1328*1328', '1664*928', '1472*1104', '1104*1472', '928*1664', '2048*2048'
];

// ── Per-model UI parameter schemas (select / range / checkbox ONLY) ────
function alibabaSchema(is3Pro) {
  return {
    size: {
      type: 'select',
      label: 'Size',
      options: is3Pro ? ALIBABA_SIZE_OPTIONS_3_0 : ALIBABA_SIZE_OPTIONS_LEGACY,
      default: is3Pro ? '' : '1328*1328',
    },
    n: {
      type: 'range',
      label: 'Number of images',
      min: 1, max: is3Pro ? 6 : 4, step: 1,
      default: 1,
    },
    seed_mode: {
      type: 'checkbox',
      label: 'Use fixed seed',
      default: false,
    },
    seed: {
      type: 'range',
      label: 'Seed',
      min: 0, max: 999999999, step: 1,
      default: 0,
      dependsOn: 'seed_mode', // frontend only enables this slider when seed_mode is checked
    },
    prompt_extend: {
      type: 'checkbox',
      label: 'Smart prompt rewriting',
      default: true,
    },
    watermark: {
      type: 'checkbox',
      label: 'Add watermark',
      default: false,
    },
  };
}

function pixazoSchema() {
  return {
    width: {
      type: 'select',
      label: 'Width',
      options: [512, 768, 1024],
      default: 1024,
    },
    height: {
      type: 'select',
      label: 'Height',
      options: [512, 768, 1024],
      default: 1024,
    },
    num_steps: {
      type: 'range',
      label: 'Steps',
      min: 1, max: 8, step: 1,
      default: 4,
    },
    seed_mode: {
      type: 'checkbox',
      label: 'Use fixed seed',
      default: false,
    },
    seed: {
      type: 'range',
      label: 'Seed',
      min: 0, max: 999999999, step: 1,
      default: 0,
      dependsOn: 'seed_mode',
    },
  };
}

// Cloudflare's flux-1-schnell only accepts prompt/steps/seed (see
// providers/cloudflare.js) — no width/height control exists on their end,
// so those fields are deliberately absent here rather than shown as
// controls that silently do nothing.
function cloudflareSchema() {
  return {
    num_steps: {
      type: 'range',
      label: 'Steps',
      min: 1, max: 8, step: 1,
      default: 4,
    },
    seed_mode: {
      type: 'checkbox',
      label: 'Use fixed seed',
      default: false,
    },
    seed: {
      type: 'range',
      label: 'Seed',
      min: 0, max: 999999999, step: 1,
      default: 0,
      dependsOn: 'seed_mode',
    },
  };
}

// Per-model schema map. Every entry in ALIBABA_IMAGE_MODELS/PIXAZO/CLOUDFLARE
// must resolve to a schema here (fallback keeps things from breaking if a
// model is added without a matching entry).
const PARAM_SCHEMAS = {};
for (const m of ALIBABA_IMAGE_MODELS) {
  PARAM_SCHEMAS[m] = alibabaSchema(m === 'qwen-image-3.0-pro');
}
PARAM_SCHEMAS[PIXAZO_IMAGE_MODEL] = pixazoSchema();
PARAM_SCHEMAS[CLOUDFLARE_IMAGE_MODEL] = cloudflareSchema();

function getSchemaForModel(model) {
  return PARAM_SCHEMAS[model] || null;
}

// Build a size string from width/height for legacy callers that still pass
// those instead of a size preset (kept for backward compatibility only).
function nearestAlibabaSize(width, height) {
  const ratio = (width || 1024) / (height || 1024);
  if (ratio >= 0.9 && ratio <= 1.1) return '1328*1328';
  if (ratio > 1.1) return ratio >= 1.7 ? '1664*928' : '1472*1104';
  return ratio <= 0.6 ? '928*1664' : '1104*1472';
}

async function textToImageHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    provider = 'alibaba',
    model: requestedModel,
    size: requestedSize,
    width,
    height,
    n,
    num_steps,
    seed_mode,
    seed,
    negative_prompt,
    prompt_extend,
    watermark,
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for image generation');
  }

  // Determine provider from the selected model.
  let selectedProvider = provider;
  if (requestedModel) {
    if (ALIBABA_IMAGE_MODELS.includes(requestedModel)) selectedProvider = 'alibaba';
    else if (requestedModel === PIXAZO_IMAGE_MODEL) selectedProvider = 'pixazo';
    else if (requestedModel === CLOUDFLARE_IMAGE_MODEL) selectedProvider = 'cloudflare';
  }

  if (selectedProvider === 'alibaba' && (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id)) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }
  if (selectedProvider === 'pixazo' && !apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }
  if (selectedProvider === 'cloudflare' && (!apiKeys.cloudflare?.api_key || !apiKeys.cloudflare?.account_id)) {
    throw new Error('Cloudflare API token + Account ID not configured. Add them in Profile > API Keys.');
  }

  let imageDataUrl = null, imageUrl = null, model, resolvedParams = {};

  if (selectedProvider === 'alibaba') {
    const alibaba = new AlibabaProvider(apiKeys.alibaba.api_key, apiKeys.alibaba.workspace_id);
    model = ALIBABA_IMAGE_MODELS.includes(requestedModel) ? requestedModel : 'qwen-image';
    const schema = getSchemaForModel(model) || alibabaSchema(false);

    // size
    let sizeParam;
    if (requestedSize && (requestedSize === '' || ALIBABA_VALID_SIZES.includes(requestedSize))) {
      sizeParam = requestedSize || undefined;
    } else if (width && height) {
      sizeParam = nearestAlibabaSize(parseInt(width), parseInt(height));
    } else {
      sizeParam = schema.size.default || undefined;
    }

    const nParam = n !== undefined ? Math.min(Math.max(parseInt(n) || 1, schema.n.min), schema.n.max) : schema.n.default;
    const useFixedSeed = seed_mode === true || seed_mode === 'true' || seed_mode === 'on';
    const seedParam = useFixedSeed ? parseInt(seed) || 0 : undefined;
    const promptExtendParam = prompt_extend !== undefined ? !!(prompt_extend === true || prompt_extend === 'true' || prompt_extend === 'on') : schema.prompt_extend.default;
    const watermarkParam = watermark !== undefined ? !!(watermark === true || watermark === 'true' || watermark === 'on') : schema.watermark.default;

    resolvedParams = { size: sizeParam, n: nParam, seed: seedParam, negative_prompt, prompt_extend: promptExtendParam, watermark: watermarkParam };

    try {
      const result = await alibaba.imageGeneration(prompt, {
        model,
        size: sizeParam,
        n: nParam,
        seed: seedParam,
        negative_prompt,
        prompt_extend: promptExtendParam,
        watermark: watermarkParam,
      });

      if (result._async) {
        throw new Error(`Image generation is processing asynchronously. Task ID: ${result._taskId}. Please poll for completion.`);
      }

      const urls = result._imageUrls || [];
      if (urls.length === 0) {
        const errorMsg = result?.output?.text || result?.message || 'No image returned';
        throw new Error(errorMsg);
      }

      imageUrl = urls[0];
      resolvedParams.allImageUrls = urls;
    } catch (err) {
      throw new Error(`Alibaba Image error: ${err.message}`);
    }
  } else if (selectedProvider === 'pixazo') {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    model = PIXAZO_IMAGE_MODEL;
    const schema = getSchemaForModel(model);

    const w = schema.width.options.includes(parseInt(width)) ? parseInt(width) : schema.width.default;
    const h = schema.height.options.includes(parseInt(height)) ? parseInt(height) : schema.height.default;
    const steps = num_steps !== undefined ? Math.min(Math.max(parseInt(num_steps) || 4, schema.num_steps.min), schema.num_steps.max) : schema.num_steps.default;
    const useFixedSeed = seed_mode === true || seed_mode === 'true' || seed_mode === 'on';

    resolvedParams = { width: w, height: h, num_steps: steps };

    try {
      const params = { prompt, width: w, height: h, num_steps: steps };
      if (useFixedSeed) { params.seed = parseInt(seed) || 0; resolvedParams.seed = params.seed; }

      const result = await pixazo.generateImage(params);
      imageUrl = result.output;
    } catch (err) {
      throw new Error(`Pixazo Image error: ${err.message}`);
    }
  } else {
    const cloudflare = new CloudflareProvider(apiKeys.cloudflare.api_key, apiKeys.cloudflare.account_id);
    model = CLOUDFLARE_IMAGE_MODEL;
    const schema = getSchemaForModel(model);

    const steps = num_steps !== undefined ? Math.min(Math.max(parseInt(num_steps) || 4, schema.num_steps.min), schema.num_steps.max) : schema.num_steps.default;
    const useFixedSeed = seed_mode === true || seed_mode === 'true' || seed_mode === 'on';

    resolvedParams = { num_steps: steps };

    try {
      const params = { prompt, num_steps: steps };
      if (useFixedSeed) { params.seed = parseInt(seed) || 0; resolvedParams.seed = params.seed; }

      const result = await cloudflare.textToImage(params);
      imageDataUrl = result.imageDataUrl;
    } catch (err) {
      throw new Error(`Cloudflare Image error: ${err.message}`);
    }
  }

  return {
    imageDataUrl,
    imageUrl,
    provider: selectedProvider,
    model,
    parameters: resolvedParams,
  };
}

function getModelCatalog(userTier) {
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);

  return {
    providers: ['alibaba', 'pixazo', 'cloudflare'],
    models: {
      alibaba: isPaid ? ALIBABA_IMAGE_MODELS : [],
      pixazo: [PIXAZO_IMAGE_MODEL],
      cloudflare: [CLOUDFLARE_IMAGE_MODEL],
    },
    defaults: {
      alibaba: 'qwen-image',
      pixazo: PIXAZO_IMAGE_MODEL,
      cloudflare: CLOUDFLARE_IMAGE_MODEL,
    },
    // Per-model UI schema — the frontend renders exactly these fields for
    // whichever model is selected, using only select/range/checkbox controls.
    schemas: PARAM_SCHEMAS,
  };
}

module.exports = {
  textToImageHandler,
  getModelCatalog,
  getSchemaForModel,
  PARAM_SCHEMAS,
  ALIBABA_IMAGE_MODELS,
  PIXAZO_IMAGE_MODEL,
  CLOUDFLARE_IMAGE_MODEL,
};