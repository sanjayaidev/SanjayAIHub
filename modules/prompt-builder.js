// modules/prompt-builder.js
// Prompt Rewriter module.
//
// Flow: user pastes a reference AI-video-generation prompt (written for
// any brand/product, in any format), picks a max duration (4/6/8/10
// seconds), adds their own products (name + optional price) and branding
// (brand name + optional tagline), then hits "Regenerate". A Qwen3 model
// (served through NVIDIA's OpenAI-compatible API) rewrites the pasted
// prompt around those details — keeping the reference prompt's structure,
// tone, and technical direction, but swapping in the new brand/products
// and re-flowing the beat/scene count and timing to fit the chosen
// duration — and returns one ready-to-copy prompt.
//
// Uses the hub's shared NVIDIA free-tier key mechanism (see
// TEMPORARY_KEY_MODULES / TEMP_NVIDIA_API_KEY in routes/modules.js) so
// signed-out guests can use this too, same as chatbot / message-writer /
// social-content.

const NvidiaProvider = require('../providers/nvidia');

// Only Qwen3 is offered for this module — no model picker needed.
const QWEN_MODEL = 'qwen/qwen3-235b-a22b';
const NVIDIA_MODELS = [QWEN_MODEL];
const DEFAULT_MODEL = QWEN_MODEL;

// Max video duration options shown in the dropdown (seconds).
const ALLOWED_DURATIONS = [4, 6, 8, 10];

const MAX_PRODUCTS = 10;

function getModelCatalog() {
  return [
    {
      id: QWEN_MODEL,
      name: 'Qwen3 235B A22B',
      description: 'Alibaba Qwen3 reasoning model — used for every prompt rewrite in this module.',
    },
  ];
}

function listDurations() {
  return ALLOWED_DURATIONS;
}

// POST /api/modules/prompt-builder
// body: {
//   referencePrompt: string,        // pasted prompt to rewrite, required
//   duration: number,               // one of 4, 6, 8, 10 (seconds), required
//   products: [{ name, price }],    // 1-10 items, price optional per item
//   brandName: string,              // required
//   tagline: string,                // optional
//   model                           // optional override (only Qwen3 supported today)
// }
async function rewritePrompt(requestBody, apiKeys) {
  const {
    referencePrompt = '',
    duration,
    products = [],
    brandName = '',
    tagline = '',
    model: requestedModel,
  } = requestBody;

  if (!referencePrompt.trim()) {
    throw new Error('Paste a reference prompt first');
  }

  const durationNum = parseInt(duration, 10);
  if (!ALLOWED_DURATIONS.includes(durationNum)) {
    throw new Error(`Duration must be one of ${ALLOWED_DURATIONS.join(', ')} seconds`);
  }

  if (!brandName.trim()) {
    throw new Error('Brand name is required');
  }

  const cleanProducts = (products || [])
    .filter(p => p && p.name && p.name.trim())
    .slice(0, MAX_PRODUCTS)
    .map(p => ({ name: p.name.trim(), price: (p.price || '').trim() }));
  if (!cleanProducts.length) {
    throw new Error('Add at least one product');
  }

  if (!apiKeys.nvidia?.api_key) {
    throw new Error('NVIDIA API key not configured. Add it in Profile > API Keys.');
  }

  const model = NVIDIA_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const productsList = cleanProducts
    .map((p, i) => `${i + 1}. ${p.name}${p.price ? ` — ${p.price}` : ''}`)
    .join('\n');

  const systemPrompt = `You are an expert AI video-prompt copywriter.
You will be given a REFERENCE PROMPT — a full AI-video-generation prompt, pasted by the user, in whatever format/style it was originally written — plus a MAX DURATION, a list of PRODUCTS, and BRANDING details for the user's own brand.

Rewrite the reference prompt into a new, complete, ready-to-use AI-video-generation prompt for the user's brand, using the reference prompt purely as a style/structure guide.

Rules:
- Replace any brand name, tagline, items, or other brand-specific facts in the reference prompt with the new branding and products given below. Do not carry over any brand-specific facts from the reference prompt.
- Keep the reference prompt's overall structure, tone, and technical direction (camera language, lighting style, transitions, aesthetic, aspect ratio) wherever it isn't brand-specific.
- The reference prompt may have its own number of beats/scenes. The new brand has a different number of products — add, remove, or merge beat blocks so there is exactly one beat per new product, in the order given, renumbering beats and recalculating any timing math so the whole thing fits within a total duration of ${durationNum} seconds.
- If a product has no price, don't invent one — just describe the product.
- If no tagline is provided, omit the tagline line rather than inventing one.
- Output ONLY the complete rewritten prompt as plain text. No preamble, no explanation, no markdown code fences, no labels, no <think> or reasoning text.`;

  const userPrompt = `REFERENCE PROMPT:
"""
${referencePrompt.trim()}
"""

MAX DURATION: ${durationNum} seconds

BRANDING:
Brand Name: ${brandName.trim()}
Tagline: ${tagline.trim() || '(none provided — omit tagline line)'}

PRODUCTS (use exactly these, one beat per product, in this order):
${productsList}

Rewrite the prompt now.`;

  const nvidia = new NvidiaProvider(apiKeys.nvidia.api_key);
  let data;
  try {
    data = await nvidia.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        model,
        temperature: 0.7,
        max_tokens: 2000,
        // Qwen3 supports a "thinking" reasoning mode; turn it off so the
        // response is just the rewritten prompt, not a reasoning trace.
        extra: { chat_template_kwargs: { enable_thinking: false } },
      }
    );
  } catch (err) {
    throw new Error(`NVIDIA API error: ${err.message}`);
  }

  let rewritten = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip any stray <think> blocks or markdown code fences the model
  // sometimes adds despite the instructions above.
  rewritten = rewritten.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  rewritten = rewritten.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();

  return {
    prompt: rewritten,
    duration: durationNum,
    model,
    usage: data.usage,
  };
}

module.exports = {
  rewritePrompt,
  getModelCatalog,
  listDurations,
  NVIDIA_MODELS,
  ALLOWED_DURATIONS,
};
