// modules/message-writer.js
// Message Writer module - supports multilingual message generation
// Uses NVIDIA (trial) and Alibaba (paid) providers

const pool = require('../db');
const AlibabaProvider = require('../providers/alibaba');
const NvidiaProvider = require('../providers/nvidia');

// Model configurations per provider
const NVIDIA_MODELS = [
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'mistralai/mistral-medium-3.5-128b',
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

// Parameters supported by each model type
const MODEL_PARAMETERS = {
  // NVIDIA models support these parameters
  'nvidia': {
    temperature: { min: 0, max: 2, default: 0.7, step: 0.1 },
    max_tokens: { min: 1, max: 4096, default: 1024, step: 1 },
    top_p: { min: 0, max: 1, default: 1, step: 0.1 },
  },
  // Alibaba models support these parameters
  'alibaba': {
    temperature: { min: 0, max: 2, default: 0.7, step: 0.1 },
    max_tokens: { min: 1, max: 8192, default: 2048, step: 1 },
    top_p: { min: 0, max: 1, default: 1, step: 0.1 },
    repetition_penalty: { min: 0, max: 2, default: 1, step: 0.1 },
  }
};

async function messageWriterHandler(requestBody, apiKeys, userId) {
  const {
    prompt,
    tone = 'professional',
    language = 'en',
    length = 'medium',
    model: requestedModel,
    temperature = 0.7,
    max_tokens = 1024,
    context = '',
  } = requestBody;

  if (!prompt || !prompt.trim()) {
    throw new Error('Message content/prompt is required');
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

  // Build system prompt based on tone and language
  const toneInstructions = {
    professional: 'Write in a professional, formal tone.',
    casual: 'Write in a friendly, casual tone.',
    enthusiastic: 'Write in an enthusiastic, energetic tone.',
    empathetic: 'Write in an empathetic, understanding tone.',
    persuasive: 'Write in a persuasive, convincing tone.',
  };

  const lengthInstructions = {
    short: 'Keep the message brief (1-2 sentences).',
    medium: 'Keep the message moderate length (3-5 sentences).',
    long: 'Write a detailed message (multiple paragraphs).',
  };

  const languageMap = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    hi: 'Hindi',
    bn: 'Bengali',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    gu: 'Gujarati',
    kn: 'Kannada',
    ml: 'Malayalam',
    ur: 'Urdu',
  };

  const systemPrompt = `You are a professional message writer. 
${toneInstructions[tone] || toneInstructions.professional}
${lengthInstructions[length] || lengthInstructions.medium}
Write in ${languageMap[language] || 'English'}.

Context: ${context || 'None provided'}

Task: Write a message based on the following request:`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
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
    message: reply,
    model,
    provider,
    parameters: { temperature, max_tokens, tone, language, length },
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
    provider: isPaid ? 'alibaba' : 'nvidia'
  };
}

module.exports = {
  messageWriterHandler,
  getModelCatalog,
  MODEL_PARAMETERS,
  NVIDIA_MODELS,
  ALIBABA_MODELS
};
