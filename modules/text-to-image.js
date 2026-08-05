// modules/text-to-image.js
// Text-to-Image module supporting multiple providers (Alibaba, Pixazo, Cloudflare)
// with model-specific parameters

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const PixazoProvider = require('../providers/pixazo');
const CloudflareProvider = require('../providers/cloudflare');

// Provider configurations
const ALIBABA_IMAGE_MODELS = [
  'qwen-image',
  'qwen-image-2.0',
  'qwen-image-max',
  'qwen-image-plus',
  'wan2.6-t2i',
  'wan2.7-image-pro',
];

const PIXAZO_IMAGE_MODEL = 'flux-1-schnell';

const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// Valid sizes for Alibaba image generation (from API error message)
const ALIBABA_VALID_SIZES = ['1664*928', '1472*1104', '1328*1328', '1104*1472', '928*1664'];

// Map common aspect ratios to Alibaba sizes
function getAlibabaSize(width, height) {
  const ratio = width / height;
  
  // Square or close to square
  if (ratio >= 0.9 && ratio <= 1.1) return '1328*1328';
  
  // Landscape (width > height)
  if (ratio > 1.1) {
    if (ratio >= 1.7) return '1664*928'; // Ultra wide
    return '1472*1104'; // Standard landscape
  }
  
  // Portrait (height > width)
  if (ratio < 0.9) {
    if (ratio <= 0.6) return '928*1664'; // Ultra portrait
    return '1104*1472'; // Standard portrait
  }
  
  // Default to square
  return '1328*1328';
}

// Parameters supported by each provider's models
const MODEL_PARAMETERS = {
  'alibaba': {
    size: { 
      type: 'select', 
      options: [
        { value: '1664*928', label: 'Landscape (1664×928)' },
        { value: '1472*1104', label: 'Landscape (1472×1104)' },
        { value: '1328*1328', label: 'Square (1328×1328)' },
        { value: '1104*1472', label: 'Portrait (1104×1472)' },
        { value: '928*1664', label: 'Portrait (928×1664)' }
      ], 
      default: '1328*1328', 
      label: 'Size' 
    },
    num_steps: { type: 'range', min: 1, max: 50, default: 30, step: 1, label: 'Steps' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
    style: { type: 'select', options: ['realistic', 'artistic', 'anime', 'digital-art', 'photography'], default: 'realistic', label: 'Style' },
  },
  'pixazo': {
    width: { type: 'select', options: [512, 768, 1024], default: 1024, label: 'Width' },
    height: { type: 'select', options: [512, 768, 1024], default: 1024, label: 'Height' },
    num_steps: { type: 'range', min: 1, max: 8, default: 4, step: 1, label: 'Steps' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
  },
  'cloudflare': {
    width: { type: 'select', options: [512, 768, 1024], default: 1024, label: 'Width' },
    height: { type: 'select', options: [512, 768, 1024], default: 1024, label: 'Height' },
    num_steps: { type: 'range', min: 1, max: 8, default: 4, step: 1, label: 'Steps' },
    seed: { type: 'number', min: 1, max: 999999999, default: null, label: 'Seed (optional)' },
  }
};

async function textToImageHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    provider = 'alibaba',
    model: requestedModel,
    width = 1024,
    height = 1024,
    size: requestedSize,
    num_steps,
    seed,
    style = 'realistic',
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for image generation');
  }

  // Determine provider based on request or availability
  let selectedProvider = provider;
  
  if (requestedModel) {
    if (ALIBABA_IMAGE_MODELS.includes(requestedModel)) {
      selectedProvider = 'alibaba';
    } else if (requestedModel === PIXAZO_IMAGE_MODEL) {
      selectedProvider = 'pixazo';
    } else if (requestedModel === CLOUDFLARE_IMAGE_MODEL) {
      selectedProvider = 'cloudflare';
    }
  }

  // Check API keys
  if (selectedProvider === 'alibaba' && (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id)) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }
  
  if (selectedProvider === 'pixazo' && !apiKeys.pixazo?.api_key) {
    throw new Error('Pixazo API key not configured. Add it in Profile > API Keys.');
  }
  
  if (selectedProvider === 'cloudflare' && (!apiKeys.cloudflare?.api_key || !apiKeys.cloudflare?.account_id)) {
    throw new Error('Cloudflare API token + Account ID not configured. Add them in Profile > API Keys.');
  }

  let imageDataUrl, imageUrl, model;

  if (selectedProvider === 'alibaba') {
    const alibaba = new AlibabaProvider(
      apiKeys.alibaba.api_key,
      apiKeys.alibaba.workspace_id
    );
    
    model = requestedModel || 'qwen-image';
    
    // Build enhanced prompt with style
    let enhancedPrompt = prompt;
    if (style !== 'realistic') {
      const stylePrompts = {
        artistic: 'in an artistic style with creative interpretation',
        anime: 'in anime/manga art style',
        'digital-art': 'as digital art with vibrant colors',
        photography: 'as a professional photograph'
      };
      enhancedPrompt = `${prompt}, ${stylePrompts[style] || ''}`;
    }
    
    // Determine size - use requested size if valid, otherwise map from width/height
    let sizeParam;
    if (requestedSize && ALIBABA_VALID_SIZES.includes(requestedSize)) {
      sizeParam = requestedSize;
    } else {
      sizeParam = getAlibabaSize(parseInt(width) || 1024, parseInt(height) || 1024);
    }
    
    try {
      const result = await alibaba.imageGeneration(enhancedPrompt, {
        model,
        size: sizeParam,
        seed: seed ? parseInt(seed) : undefined,
      });

      // DashScope returns: { output: { results: [{ url }] } }
      const generated = result?.output?.results?.[0];
      if (!generated?.url) {
        throw new Error('No image returned');
      }

      imageUrl = generated.url;
      imageDataUrl = null;
    } catch (err) {
      throw new Error(`Alibaba Image error: ${err.message}`);
    }
  } else if (selectedProvider === 'pixazo') {
    const pixazo = new PixazoProvider(apiKeys.pixazo.api_key);
    
    try {
      const params = {
        prompt,
        width: parseInt(width),
        height: parseInt(height),
        num_steps: parseInt(num_steps) || 4,
      };
      if (seed) params.seed = parseInt(seed);
      
      const result = await pixazo.generateImage(params);
      imageUrl = result.output;
      imageDataUrl = null; // Pixazo returns URL directly
      model = PIXAZO_IMAGE_MODEL;
    } catch (err) {
      throw new Error(`Pixazo Image error: ${err.message}`);
    }
  } else {
    const cloudflare = new CloudflareProvider(
      apiKeys.cloudflare.api_key,
      apiKeys.cloudflare.account_id
    );
    
    try {
      const params = {
        prompt,
        width: parseInt(width),
        height: parseInt(height),
        num_steps: parseInt(num_steps) || 4,
      };
      if (seed) params.seed = parseInt(seed);
      
      const result = await cloudflare.textToImage(params);
      imageDataUrl = result.imageDataUrl;
      imageUrl = null;
      model = CLOUDFLARE_IMAGE_MODEL;
    } catch (err) {
      throw new Error(`Cloudflare Image error: ${err.message}`);
    }
  }

  return {
    imageDataUrl,
    imageUrl,
    provider: selectedProvider,
    model,
    parameters: { 
      size: selectedProvider === 'alibaba' ? sizeParam : { width, height },
      num_steps, 
      seed, 
      style 
    }
  };
}

function getModelCatalog(userTier) {
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);
  
  return {
    providers: ['alibaba', 'pixazo', 'cloudflare'],
    models: {
      alibaba: isPaid ? ALIBABA_IMAGE_MODELS : [],
      pixazo: [PIXAZO_IMAGE_MODEL],
      cloudflare: [CLOUDFLARE_IMAGE_MODEL]
    },
    defaults: {
      alibaba: 'qwen-image',
      pixazo: PIXAZO_IMAGE_MODEL,
      cloudflare: CLOUDFLARE_IMAGE_MODEL
    },
    parameters: MODEL_PARAMETERS
  };
}

module.exports = {
  textToImageHandler,
  getModelCatalog,
  MODEL_PARAMETERS,
  ALIBABA_IMAGE_MODELS,
  PIXAZO_IMAGE_MODEL,
  CLOUDFLARE_IMAGE_MODEL
};
