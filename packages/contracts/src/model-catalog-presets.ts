// Preset model metadata catalog: popular LLMs with context windows, modalities and reasoning.
// Kept separate from catalog logic so both client and server can import without bloat.

export interface ModelPreset {
  readonly id: string
  readonly name: string
  readonly context: number
  readonly maxTokens?: number
  readonly vision?: boolean
  readonly reasoning?: boolean
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
  // DeepSeek
  { id: 'deepseek-chat', name: 'DeepSeek Chat', context: 128000, maxTokens: 8192 },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', context: 128000, maxTokens: 8192, reasoning: true },
  { id: 'deepseek-v3', name: 'DeepSeek V3', context: 128000, maxTokens: 8192 },
  { id: 'deepseek-r1', name: 'DeepSeek R1', context: 128000, maxTokens: 8192, reasoning: true },
  { id: 'deepseek-v4', name: 'DeepSeek V4', context: 128000, maxTokens: 8192 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 128000, maxTokens: 8192 },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', context: 128000, maxTokens: 8192 },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision',
    context: 128000,
    maxTokens: 8192,
    vision: true,
  },

  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', context: 128000, maxTokens: 16384, vision: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', context: 128000, maxTokens: 16384, vision: true },
  { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', context: 128000, maxTokens: 16384, vision: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', context: 128000, maxTokens: 4096, vision: true },
  { id: 'gpt-4', name: 'GPT-4', context: 8192, maxTokens: 4096 },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', context: 16385, maxTokens: 4096 },
  { id: 'o1', name: 'o1', context: 200000, maxTokens: 100000, vision: true, reasoning: true },
  { id: 'o1-mini', name: 'o1-mini', context: 128000, maxTokens: 65536, reasoning: true },
  { id: 'o1-preview', name: 'o1-preview', context: 128000, maxTokens: 32768, reasoning: true },
  { id: 'o3-mini', name: 'o3-mini', context: 200000, maxTokens: 100000, reasoning: true },
  { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', context: 128000, maxTokens: 16384, vision: true },

  // Anthropic Claude
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    context: 200000,
    maxTokens: 64000,
    vision: true,
    reasoning: true,
  },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', context: 200000, maxTokens: 8192, vision: true },
  { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', context: 200000, maxTokens: 8192 },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', context: 200000, maxTokens: 4096, vision: true },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', context: 200000, maxTokens: 4096, vision: true },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', context: 200000, maxTokens: 4096, vision: true },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    context: 200000,
    maxTokens: 16384,
    vision: true,
    reasoning: true,
  },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', context: 200000, maxTokens: 16384, vision: true, reasoning: true },
  { id: 'claude-2.1', name: 'Claude 2.1', context: 200000, maxTokens: 4096 },
  { id: 'claude-2.0', name: 'Claude 2.0', context: 100000, maxTokens: 4096 },
  { id: 'claude-instant-1.2', name: 'Claude Instant 1.2', context: 100000, maxTokens: 4096 },

  // Google Gemini
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', context: 1048576, maxTokens: 8192, vision: true },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', context: 1048576, maxTokens: 8192, vision: true },
  {
    id: 'gemini-2.0-flash-thinking-exp',
    name: 'Gemini 2.0 Flash Thinking',
    context: 1048576,
    maxTokens: 65536,
    vision: true,
    reasoning: true,
  },
  { id: 'gemini-2.0-pro-exp', name: 'Gemini 2.0 Pro', context: 2097152, maxTokens: 8192, vision: true },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', context: 2097152, maxTokens: 8192, vision: true },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', context: 1048576, maxTokens: 8192, vision: true },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B', context: 1048576, maxTokens: 8192, vision: true },

  // Alibaba Qwen
  { id: 'qwen-max', name: 'Qwen Max', context: 32768, maxTokens: 8192 },
  { id: 'qwen-plus', name: 'Qwen Plus', context: 131072, maxTokens: 8192 },
  { id: 'qwen-turbo', name: 'Qwen Turbo', context: 1000000, maxTokens: 8192 },
  { id: 'qwen-long', name: 'Qwen Long', context: 10000000, maxTokens: 6000 },
  { id: 'qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-2.5-32b-instruct', name: 'Qwen 2.5 32B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-2.5-14b-instruct', name: 'Qwen 2.5 14B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-2.5-7b-instruct', name: 'Qwen 2.5 7B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-2.5-coder-7b-instruct', name: 'Qwen 2.5 Coder 7B', context: 131072, maxTokens: 8192 },
  { id: 'qwen-vl-max', name: 'Qwen VL Max', context: 32768, maxTokens: 2048, vision: true },
  { id: 'qwen-vl-plus', name: 'Qwen VL Plus', context: 32768, maxTokens: 2048, vision: true },
  { id: 'qvq-72b-preview', name: 'QvQ 72B', context: 32768, maxTokens: 8192, vision: true, reasoning: true },
  { id: 'qwq-32b-preview', name: 'QwQ 32B', context: 32768, maxTokens: 8192, reasoning: true },

  // Moonshot AI
  { id: 'kimi-k2', name: 'Kimi K2', context: 128000, maxTokens: 8192 },
  { id: 'moonshot-v1-8k', name: 'Moonshot v1 8k', context: 8192, maxTokens: 4096 },
  { id: 'moonshot-v1-32k', name: 'Moonshot v1 32k', context: 32768, maxTokens: 4096 },
  { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', context: 128000, maxTokens: 4096 },

  // Zhipu GLM
  { id: 'glm-4-plus', name: 'GLM-4 Plus', context: 128000, maxTokens: 4096 },
  { id: 'glm-4-air', name: 'GLM-4 Air', context: 128000, maxTokens: 4096 },
  { id: 'glm-4-flash', name: 'GLM-4 Flash', context: 128000, maxTokens: 4096 },
  { id: 'glm-4-long', name: 'GLM-4 Long', context: 1000000, maxTokens: 4096 },
  { id: 'glm-4v-plus', name: 'GLM-4V Plus', context: 8192, maxTokens: 4096, vision: true },
  { id: 'glm-4v', name: 'GLM-4V', context: 2048, maxTokens: 1024, vision: true },
  { id: 'glm-zero-preview', name: 'GLM Zero', context: 128000, maxTokens: 4096, reasoning: true },
  { id: 'codegeex-4', name: 'CodeGeeX 4', context: 128000, maxTokens: 4096 },

  // ByteDance Doubao
  { id: 'doubao-pro-32k', name: 'Doubao Pro 32k', context: 32768, maxTokens: 4096 },
  { id: 'doubao-pro-128k', name: 'Doubao Pro 128k', context: 128000, maxTokens: 4096 },
  { id: 'doubao-pro-256k', name: 'Doubao Pro 256k', context: 256000, maxTokens: 4096 },
  { id: 'doubao-lite-32k', name: 'Doubao Lite 32k', context: 32768, maxTokens: 4096 },
  { id: 'doubao-lite-128k', name: 'Doubao Lite 128k', context: 128000, maxTokens: 4096 },
  { id: 'doubao-vision-pro-32k', name: 'Doubao Vision Pro', context: 32768, maxTokens: 4096, vision: true },

  // MiniMax
  { id: 'minimax-text-01', name: 'MiniMax Text 01', context: 1000000, maxTokens: 8192 },
  { id: 'abab6.5s-chat', name: 'MiniMax abab6.5s', context: 245760, maxTokens: 4096 },
  { id: 'abab6.5-chat', name: 'MiniMax abab6.5', context: 245760, maxTokens: 4096 },

  // Baichuan
  { id: 'baichuan4', name: 'Baichuan 4', context: 32768, maxTokens: 4096 },
  { id: 'baichuan3-turbo', name: 'Baichuan 3 Turbo', context: 32768, maxTokens: 4096 },

  // Meta Llama
  { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B', context: 128000, maxTokens: 8192 },
  { id: 'llama-3.1-405b-instruct', name: 'Llama 3.1 405B', context: 128000, maxTokens: 8192 },
  { id: 'llama-3.1-70b-instruct', name: 'Llama 3.1 70B', context: 128000, maxTokens: 8192 },
  { id: 'llama-3.1-8b-instruct', name: 'Llama 3.1 8B', context: 128000, maxTokens: 8192 },
  { id: 'llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision', context: 128000, maxTokens: 8192, vision: true },
  { id: 'llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', context: 128000, maxTokens: 8192, vision: true },

  // Mistral
  { id: 'mistral-large-latest', name: 'Mistral Large', context: 128000, maxTokens: 8192 },
  { id: 'codestral-latest', name: 'Codestral', context: 256000, maxTokens: 8192 },
  { id: 'pixtral-large-latest', name: 'Pixtral Large', context: 128000, maxTokens: 8192, vision: true },

  // Perplexity
  { id: 'sonar-pro', name: 'Sonar Pro', context: 200000, maxTokens: 8192 },
  { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', context: 128000, maxTokens: 8192, reasoning: true },
  { id: 'sonar', name: 'Sonar', context: 128000, maxTokens: 8192 },
]
