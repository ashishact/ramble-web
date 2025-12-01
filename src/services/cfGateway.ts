/**
 * Cloudflare AI Gateway - Unified LLM API Client
 *
 * Provides a clean interface for calling various LLM providers through
 * Cloudflare's AI Gateway with streaming and non-streaming support.
 */

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'groq';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  provider: Provider;
  model: string;
  apiKey: string;
  messages: Message[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

// Model catalog for UI dropdowns
export const PROVIDER_MODELS: Record<Provider, { label: string; value: string }[]> = {
  gemini: [
    { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash' },
    { label: 'Gemini 2.5 Flash Lite', value: 'google/gemini-2.5-flash-lite' },
  ],
  openai: [
    { label: 'GPT-5', value: 'openai/gpt-5' },
    { label: 'GPT-5 Mini', value: 'openai/gpt-5-mini' },
    { label: 'GPT-5 Nano', value: 'openai/gpt-5-nano' },
  ],
  anthropic: [
    { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5-20250929' },
    { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5-20251001' },
    { label: 'Claude Opus 4.5', value: 'anthropic/claude-opus-4-5-20251101' },
  ],
  groq: [
    { label: 'GPT OSS 120B', value: 'groq/openai/gpt-oss-120b' },
    { label: 'GPT OSS 20B', value: 'groq/openai/gpt-oss-20b' },
    { label: 'Kimi K2 Instruct', value: 'groq/moonshotai/kimi-k2-instruct-0905' },
    { label: 'Qwen 3 32B', value: 'groq/qwen/qwen3-32b' },
    { label: 'Llama 3.1 8B Instant', value: 'groq/llama-3.1-8b-instant' },
  ],
};

/**
 * Streaming chat completion
 * Calls the Cloudflare AI Gateway and streams tokens back via callbacks
 */
export async function streamChat(
  options: ChatOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const { model, apiKey, messages, systemPrompt, temperature, maxTokens } = options;

  // Prepend system message if provided
  const allMessages: Message[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  try {
    const response = await fetch(`${WORKER_URL}/api/cf-gateway`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey,
        model,
        messages: allMessages,
        stream: true,
        temperature,
        maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Stream not available');
    }

    const decoder = new TextDecoder();
    let accumulatedResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]' || !data) {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;

            if (content) {
              accumulatedResponse += content;
              callbacks.onToken(content);
            }
          } catch {
            // Skip invalid JSON chunks (normal for streaming)
          }
        }
      }
    }

    callbacks.onComplete(accumulatedResponse);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Non-streaming chat completion
 * Returns the full response as a string
 */
export async function chat(options: ChatOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullText = '';

    streamChat(options, {
      onToken: (token) => {
        fullText += token;
      },
      onComplete: () => {
        resolve(fullText);
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
}

// ============================================================================
// Convenience functions with pre-configured models
// ============================================================================

/**
 * Gemini 2.5 Flash - Fast, capable model for most tasks
 */
export const geminiFlash = {
  chat: (apiKey: string, messages: Message[], systemPrompt?: string): Promise<string> =>
    chat({
      provider: 'gemini',
      model: 'google/gemini-2.5-flash',
      apiKey,
      messages,
      systemPrompt,
    }),

  stream: (
    apiKey: string,
    messages: Message[],
    callbacks: StreamCallbacks,
    systemPrompt?: string
  ): Promise<void> =>
    streamChat(
      {
        provider: 'gemini',
        model: 'google/gemini-2.5-flash',
        apiKey,
        messages,
        systemPrompt,
      },
      callbacks
    ),
};

/**
 * Groq GPT-OSS 120B - Fast inference via Groq
 */
export const groqGptOss = {
  chat: (apiKey: string, messages: Message[], systemPrompt?: string): Promise<string> =>
    chat({
      provider: 'groq',
      model: 'groq/openai/gpt-oss-120b',
      apiKey,
      messages,
      systemPrompt,
    }),

  stream: (
    apiKey: string,
    messages: Message[],
    callbacks: StreamCallbacks,
    systemPrompt?: string
  ): Promise<void> =>
    streamChat(
      {
        provider: 'groq',
        model: 'groq/openai/gpt-oss-120b',
        apiKey,
        messages,
        systemPrompt,
      },
      callbacks
    ),
};

/**
 * Claude Sonnet 4.5 - Anthropic's balanced model
 */
export const claudeSonnet = {
  chat: (apiKey: string, messages: Message[], systemPrompt?: string): Promise<string> =>
    chat({
      provider: 'anthropic',
      model: 'anthropic/claude-sonnet-4-5-20250929',
      apiKey,
      messages,
      systemPrompt,
    }),

  stream: (
    apiKey: string,
    messages: Message[],
    callbacks: StreamCallbacks,
    systemPrompt?: string
  ): Promise<void> =>
    streamChat(
      {
        provider: 'anthropic',
        model: 'anthropic/claude-sonnet-4-5-20250929',
        apiKey,
        messages,
        systemPrompt,
      },
      callbacks
    ),
};

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: Provider): string {
  return PROVIDER_MODELS[provider][0].value;
}

/**
 * Extract provider from model string (e.g., "google/gemini-2.5-flash" -> "gemini")
 */
export function getProviderFromModel(model: string): Provider {
  if (model.startsWith('google/')) return 'gemini';
  if (model.startsWith('openai/')) return 'openai';
  if (model.startsWith('anthropic/')) return 'anthropic';
  if (model.startsWith('groq/')) return 'groq';
  throw new Error(`Unknown provider for model: ${model}`);
}
