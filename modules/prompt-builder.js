// modules/prompt-builder.js
// Structured Prompt Builder module.
//
// Flow: user picks a visual style (dropdown), enters brand + product info,
// then per product hits "Enhance" on the Description field and/or the
// Visual Details field. Each Enhance call sends that field's current text
// plus full context (style, brand, category, product) to an NVIDIA text
// model and gets back a rewritten version of just that field. There is no
// template-stitched "final prompt" step — the enhanced fields ARE the
// output the user copies out.
//
// Uses the hub's shared NVIDIA free-tier key mechanism (see
// TEMPORARY_KEY_MODULES / TEMP_NVIDIA_API_KEY in routes/modules.js) —
// same as chatbot / message-writer / social-content.

const NvidiaProvider = require('../providers/nvidia');

// Visual styles offered in the dropdown. Used both to populate the UI and
// to steer the AI enhancement toward a consistent look across a catalog.
const STYLE_OPTIONS = [
  { id: 'realistic', name: 'Realistic', icon: '📷', description: 'Hyper-realistic, photographic lighting and true-to-life textures.' },
  { id: '3d', name: '3D Render', icon: '🧊', description: 'Polished 3D CGI render with studio-quality product lighting.' },
  { id: '2d', name: '2D Flat', icon: '🔷', description: 'Clean flat 2D illustration with bold vector shapes and color.' },
  { id: 'cartoon', name: 'Cartoon', icon: '🎨', description: 'Playful animated cartoon style with a vibrant palette.' },
  { id: 'hologram', name: 'Holographic', icon: '💠', description: 'Futuristic holographic projection with neon-chromatic glow.' },
  { id: 'pixar', name: 'Pixar-style 3D', icon: '🎬', description: 'Warm, storybook 3D animation with soft global illumination.' },
  { id: 'popup-book', name: 'Pop-up Book', icon: '📖', description: 'Whimsical layered paper pop-up-book diorama look.' },
  { id: 'motion-graphics', name: 'Motion Graphics', icon: '⚡', description: 'Bold modern motion-graphics style with kinetic shapes.' },
];

const STYLE_MAP = Object.fromEntries(STYLE_OPTIONS.map(s => [s.id, s]));

const NVIDIA_MODELS = [
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
];
const DEFAULT_MODEL = 'meta/llama-3.1-70b-instruct';

const FIELD_LABELS = {
  description: 'product description',
  visualDetails: 'visual / on-screen scene details for an AI video generator',
};

function getModelCatalog() {
  return { models: NVIDIA_MODELS, default: DEFAULT_MODEL, provider: 'nvidia' };
}

function listStyles() {
  return STYLE_OPTIONS;
}

// POST /api/modules/prompt-builder  (dispatched from routes/modules.js)
// body: {
//   field: 'description' | 'visualDetails',
//   text: string,               // current field content the user typed
//   styleId: string,            // one of STYLE_OPTIONS ids, applies catalog-wide
//   brandName, category, tagline,
//   productName, price,         // context for this specific product
//   model                       // optional override
// }
async function enhanceField(requestBody, apiKeys, userId) {
  const {
    field,
    text = '',
    styleId,
    brandName = '',
    category = '',
    tagline = '',
    productName = '',
    price = '',
    model: requestedModel,
  } = requestBody;

  if (!field || !FIELD_LABELS[field]) {
    throw new Error('field must be "description" or "visualDetails"');
  }
  if (!text || !text.trim()) {
    throw new Error(`Enter some ${FIELD_LABELS[field]} text before enhancing it`);
  }
  if (!apiKeys.nvidia?.api_key) {
    throw new Error('NVIDIA API key not configured. Add it in Profile > API Keys.');
  }

  const style = STYLE_MAP[styleId] || null;
  const model = NVIDIA_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const contextLines = [
    brandName && `Brand: ${brandName}`,
    category && `Category: ${category}`,
    tagline && `Tagline: ${tagline}`,
    productName && `Product: ${productName}`,
    price && `Price: ${price}`,
    style && `Visual style for the whole catalog: ${style.name} — ${style.description}`,
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are an expert copywriter for AI video/image generation prompts.
You will be given a ${FIELD_LABELS[field]} that the user already wrote, plus context about the brand, product, and chosen visual style.
Rewrite ONLY that text to be more vivid, specific, and production-ready — keep the user's original intent and any facts they included (price, materials, etc.), but sharpen the language, add concrete sensory/visual detail appropriate to the chosen style, and keep it concise (1-3 sentences).
Respond with ONLY the rewritten text. No preamble, no quotes, no markdown, no labels.`;

  const userPrompt = `${contextLines}\n\nCurrent ${FIELD_LABELS[field]}:\n"""${text.trim()}"""\n\nRewrite it now.`;

  const nvidia = new NvidiaProvider(apiKeys.nvidia.api_key);
  let data;
  try {
    data = await nvidia.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { model, temperature: 0.8, max_tokens: 300 }
    );
  } catch (err) {
    throw new Error(`NVIDIA API error: ${err.message}`);
  }

  let enhanced = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip accidental wrapping quotes the model sometimes adds.
  enhanced = enhanced.replace(/^["'“](.*)["'”]$/s, '$1').trim();

  return {
    field,
    enhanced,
    model,
    usage: data.usage,
  };
}

module.exports = {
  listStyles,
  enhanceField,
  getModelCatalog,
  STYLE_OPTIONS,
  NVIDIA_MODELS,
};
