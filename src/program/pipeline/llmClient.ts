/**
 * LLM Client
 *
 * Unified interface for calling LLM providers through the Cloudflare AI Gateway.
 * Uses the existing cfGateway service from the codebase.
 */

import { chat, type Message } from '../../services/cfGateway';
import { settingsHelpers } from '../../stores/settingsStore';
import type { LLMProvider } from '../extractors/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('Pipeline');

// ============================================================================
// Types
// ============================================================================

export interface LLMRequest {
  provider: LLMProvider;
  prompt: string;
  systemPrompt?: string;
  options?: {
    temperature?: number;
    max_tokens?: number;
  };
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens_used: {
    prompt: number;
    completion: number;
    total: number;
  };
  processing_time_ms: number;
}

// ============================================================================
// Provider Configurations
// ============================================================================

const PROVIDER_CONFIGS: Record<LLMProvider, { model: string; cfProvider: 'groq' | 'gemini' }> = {
  groq: {
    model: 'groq/openai/gpt-oss-120b', // Fast OSS model via Groq
    cfProvider: 'groq',
  },
  gemini: {
    model: 'google/gemini-2.5-flash', // Smart model for complex extractions
    cfProvider: 'gemini',
  },
};

// ============================================================================
// LLM Client Implementation
// ============================================================================

/**
 * Call an LLM provider through the Cloudflare AI Gateway
 */
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();
  const config = PROVIDER_CONFIGS[request.provider];

  console.log('[LLM] Calling', config.model, 'prompt length:', request.prompt.length);

  try {
    // Get API key from settings
    const apiKey = getApiKey(request.provider);
    console.log('[LLM] API key present:', !!apiKey, 'length:', apiKey?.length);

    // Build messages
    const messages: Message[] = [{ role: 'user', content: request.prompt }];

    // Call via cfGateway
    console.log('[LLM] Sending request to cfGateway...');
    const content = await chat({
      provider: config.cfProvider,
      model: config.model,
      apiKey,
      messages,
      systemPrompt: request.systemPrompt,
      temperature: request.options?.temperature,
      maxTokens: request.options?.max_tokens,
    });

    const processingTimeMs = Date.now() - startTime;
    console.log('[LLM] Response received, length:', content.length, 'time:', processingTimeMs, 'ms');

    // Estimate tokens (cfGateway doesn't return token counts directly)
    const estimatedPromptTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
    const estimatedCompletionTokens = Math.ceil(content.length / 4);

    logger.debug('LLM call completed', {
      provider: request.provider,
      model: config.model,
      time_ms: processingTimeMs,
      response_length: content.length,
    });

    return {
      content,
      model: config.model,
      tokens_used: {
        prompt: estimatedPromptTokens,
        completion: estimatedCompletionTokens,
        total: estimatedPromptTokens + estimatedCompletionTokens,
      },
      processing_time_ms: processingTimeMs,
    };
  } catch (error) {
    console.error('[LLM] Call failed:', error);
    logger.error('LLM call failed', {
      provider: request.provider,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// ============================================================================
// API Key Management
// ============================================================================

function getApiKey(provider: LLMProvider): string {
  const settings = settingsHelpers.getSettings();

  if (provider === 'groq') {
    const key = settings.providers.groq.apiKey;
    if (!key) {
      throw new Error('Groq API key not configured. Set it in Settings.');
    }
    return key;
  }

  if (provider === 'gemini') {
    const key = settings.providers.gemini.apiKey;
    if (!key) {
      throw new Error('Gemini API key not configured. Set it in Settings.');
    }
    return key;
  }

  throw new Error(`Unknown provider: ${provider}`);
}
