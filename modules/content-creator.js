// modules/content-creator.js
// Social Content & Resume Creator module
// Supports content generation with multiple providers and model-specific parameters

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const NvidiaProvider = require('../providers/nvidia');

// Model configurations
const NVIDIA_MODELS = [
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  // mistralai/mistral-medium-3.5-128b removed 2026-08-10 (410 Gone, EOL 2026-08-07)
];

const ALIBABA_MODELS = [
  'qwen3.5-plus',
  'qwen3-max',
  'qwen-plus',
  'qwen-turbo',
  'glm-5.1',
];

const DEFAULT_NVIDIA_MODEL = 'meta/llama-3.1-70b-instruct';
const DEFAULT_ALIBABA_MODEL = 'qwen3.5-plus';

// Parameters supported by each provider's models
const MODEL_PARAMETERS = {
  'nvidia': {
    temperature: { type: 'range', min: 0, max: 2, default: 0.7, step: 0.1, label: 'Temperature' },
    max_tokens: { type: 'range', min: 1, max: 4096, default: 2048, step: 1, label: 'Max Tokens' },
    top_p: { type: 'range', min: 0, max: 1, default: 1, step: 0.1, label: 'Top P' },
  },
  'alibaba': {
    temperature: { type: 'range', min: 0, max: 2, default: 0.7, step: 0.1, label: 'Temperature' },
    max_tokens: { type: 'range', min: 1, max: 8192, default: 2048, step: 1, label: 'Max Tokens' },
    top_p: { type: 'range', min: 0, max: 1, default: 1, step: 0.1, label: 'Top P' },
    repetition_penalty: { type: 'range', min: 0, max: 2, default: 1, step: 0.1, label: 'Repetition Penalty' },
  }
};

// Content type templates
const CONTENT_TEMPLATES = {
  social_post: {
    platforms: ['linkedin', 'twitter', 'instagram', 'facebook'],
    instructions: {
      linkedin: 'Write a professional LinkedIn post with engaging opening, valuable insights, and a call-to-action.',
      twitter: 'Write a concise Twitter thread (max 280 chars per tweet) with hooks and engagement.',
      instagram: 'Write an Instagram caption with emojis, hashtags, and engaging questions.',
      facebook: 'Write a friendly Facebook post that encourages interaction and sharing.',
    }
  },
  resume: {
    sections: ['summary', 'experience', 'skills', 'education'],
    instructions: 'Create a professional resume section with action verbs, quantifiable achievements, and relevant keywords.'
  },
  blog_intro: {
    instructions: 'Write an engaging blog introduction that hooks readers and outlines what they will learn.'
  },
  email: {
    types: ['professional', 'marketing', 'followup', 'cold_outreach'],
    instructions: 'Write a compelling email with clear subject line, personalized greeting, value proposition, and call-to-action.'
  }
};

async function contentCreatorHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    contentType = 'social_post',
    platform = 'linkedin',
    tone = 'professional',
    language = 'en',
    model: requestedModel,
    temperature = 0.7,
    max_tokens = 2048,
    additionalContext = '',
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Content prompt is required');
  }

  // Determine provider based on model or availability
  let provider = 'nvidia';
  let model = DEFAULT_NVIDIA_MODEL;
  
  if (requestedModel) {
    if (ALIBABA_MODELS.includes(requestedModel)) {
      provider = 'alibaba';
      model = requestedModel;
    } else if (NVIDIA_MODELS.includes(requestedModel)) {
      provider = 'nvidia';
      model = requestedModel;
    }
  }

  // Check API keys
  if (provider === 'nvidia' && !apiKeys.nvidia?.api_key) {
    throw new Error('NVIDIA API key not configured. Add it in Profile > API Keys.');
  }
  
  if (provider === 'alibaba' && (!apiKeys.alibaba?.api_key || !apiKeys.alibaba?.workspace_id)) {
    throw new Error('Alibaba Cloud API key + Workspace ID not configured. Add them in Profile > API Keys.');
  }

  // Build system prompt based on content type
  let systemPrompt = 'You are a professional content creator.';
  
  if (contentType === 'social_post') {
    const platformInstructions = CONTENT_TEMPLATES.social_post.instructions[platform] || 
                                  CONTENT_TEMPLATES.social_post.instructions.linkedin;
    systemPrompt += ` ${platformInstructions}`;
  } else if (contentType === 'resume') {
    systemPrompt += ` ${CONTENT_TEMPLATES.resume.instructions}`;
  } else if (contentType === 'blog_intro') {
    systemPrompt += ` ${CONTENT_TEMPLATES.blog_intro.instructions}`;
  } else if (contentType === 'email') {
    systemPrompt += ` ${CONTENT_TEMPLATES.email.instructions}`;
  }

  const languageMap = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', 
    it: 'Italian', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese',
    ko: 'Korean', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu'
  };

  systemPrompt += `\n\nWrite in ${languageMap[language] || 'English'}.`;
  systemPrompt += `\nTone: ${tone}`;
  systemPrompt += `\n\nAdditional context: ${additionalContext || 'None'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Create ${contentType} content about: ${prompt}` }
  ];

  let reply = '';
  let usage = null;

  if (provider === 'nvidia') {
    const nvidia = new NvidiaProvider(apiKeys.nvidia.api_key);
    try {
      const data = await nvidia.chatCompletion(messages, { 
        model, 
        temperature: parseFloat(temperature), 
        max_tokens: parseInt(max_tokens) 
      });
      reply = data.choices?.[0]?.message?.content || '';
      usage = data.usage;
    } catch (err) {
      throw new Error(`NVIDIA API error: ${err.message}`);
    }
  } else {
    const alibaba = new AlibabaProvider(
      apiKeys.alibaba.api_key, 
      apiKeys.alibaba.workspace_id
    );
    try {
      const data = await alibaba.chatCompletion(messages, { 
        model, 
        temperature: parseFloat(temperature), 
        max_tokens: parseInt(max_tokens) 
      });
      reply = data.choices?.[0]?.message?.content || '';
      usage = data.usage;
    } catch (err) {
      throw new Error(`Alibaba API error: ${err.message}`);
    }
  }

  return {
    content: reply,
    model,
    provider,
    contentType,
    platform: contentType === 'social_post' ? platform : undefined,
    parameters: { temperature, max_tokens, tone, language },
    usage
  };
}

function getModelCatalog(userTier) {
  const isPaid = ['basic', 'pro', 'enterprise'].includes(userTier);
  
  let models = [...NVIDIA_MODELS];
  if (isPaid) {
    models = [...models, ...ALIBABA_MODELS];
  }

  return {
    models,
    default: isPaid ? DEFAULT_ALIBABA_MODEL : DEFAULT_NVIDIA_MODEL,
    parameters: MODEL_PARAMETERS,
    provider: isPaid ? 'alibaba' : 'nvidia',
    contentTypes: Object.keys(CONTENT_TEMPLATES)
  };
}

module.exports = {
  contentCreatorHandler,
  getModelCatalog,
  MODEL_PARAMETERS,
  NVIDIA_MODELS,
  ALIBABA_MODELS,
  CONTENT_TEMPLATES
};