/**
 * LLM Client
 *
 * Unified interface for calling LLM providers through the Cloudflare AI Gateway.
 * Uses tier abstraction - resolves LLM tiers (small/medium/large) to concrete providers.
 */

import { chat, type Message } from '../services/cfGateway';
import { settingsHelpers } from '../stores/settingsStore';
import type { LLMTier, LLMProvider as ConcreteProvider } from './types/llmTiers';
import { resolveLLMTier } from './llmResolver';
import { createLogger } from './utils/logger';
import { telemetry } from './telemetry';
import { llmTracker } from './telemetry';

const logger = createLogger('Pipeline');

// ============================================================================
// Types
// ============================================================================

export interface LLMRequest {
  /** LLM tier to use (small/medium/large) */
  tier: LLMTier;
  prompt: string;
  systemPrompt?: string;
  /** Identifies the caller for telemetry (e.g. 'extraction', 'normalize', 'tree-editor') */
  category?: string;
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
// Provider Mapping
// ============================================================================

/**
 * Map our abstract provider types to CF Gateway provider strings
 */
function mapProviderToCF(provider: ConcreteProvider): 'groq' | 'gemini' | 'anthropic' | 'openai' {
  // For now, only groq and gemini are supported by cfGateway
  // Others will need to be added as needed
  if (provider === 'groq') return 'groq';
  if (provider === 'gemini') return 'gemini';
  if (provider === 'anthropic') return 'groq'; // Fallback to groq for now
  if (provider === 'openai') return 'groq'; // Fallback to groq for now
  return 'groq';
}

// ============================================================================
// LLM Client Implementation
// ============================================================================

/**
 * Call an LLM through the Cloudflare AI Gateway using tier abstraction
 */
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();

  // Resolve tier to concrete provider and model
  const resolved = resolveLLMTier(request.tier);
  const cfProvider = mapProviderToCF(resolved.provider);

  console.log('[LLM] Tier:', request.tier, '→ Provider:', resolved.provider, 'Model:', resolved.model, 'prompt length:', request.prompt.length);

  try {
    // Get API key from settings based on resolved provider
    const apiKey = getApiKey(resolved.provider);
    console.log('[LLM] API key present:', !!apiKey, 'length:', apiKey?.length);

    // Build messages
    const messages: Message[] = [{ role: 'user', content: request.prompt }];

    // Call via cfGateway
    console.log('[LLM] Sending request to cfGateway...');
    const content = await chat({
      provider: cfProvider,
      model: resolved.model,
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
      tier: request.tier,
      provider: resolved.provider,
      model: resolved.model,
      time_ms: processingTimeMs,
      response_length: content.length,
    });

    // Record telemetry
    const llmCategory = request.category ?? 'unknown';
    try {
      telemetry.emit('llm', `${llmCategory}`, 'end', {
        tier: request.tier,
        model: resolved.model,
        provider: resolved.provider,
        durationMs: processingTimeMs,
        inputTokens: estimatedPromptTokens,
        outputTokens: estimatedCompletionTokens,
      }, { status: 'success' });
      llmTracker.recordLLMCall({
        ts: Date.now(),
        category: llmCategory,
        tier: request.tier,
        model: resolved.model,
        provider: resolved.provider,
        inputTokens: estimatedPromptTokens,
        outputTokens: estimatedCompletionTokens,
        durationMs: processingTimeMs,
        status: 'success',
        promptLength: request.prompt.length + (request.systemPrompt?.length ?? 0),
        responseLength: content.length,
      });
    } catch { /* telemetry should never break LLM calls */ }

    return {
      content,
      model: resolved.model,
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
      tier: request.tier,
      provider: resolved.provider,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Record failed LLM call
    const llmCategory = request.category ?? 'unknown';
    try {
      telemetry.emit('llm', `${llmCategory}`, 'end', {
        tier: request.tier,
        model: resolved.model,
        provider: resolved.provider,
        error: error instanceof Error ? error.message : 'Unknown error',
        promptPreview: request.prompt,
        systemPromptPreview: request.systemPrompt,
        durationMs: Date.now() - startTime,
      }, { status: 'error', isLLM: true });
      llmTracker.recordLLMCall({
        ts: Date.now(),
        category: llmCategory,
        tier: request.tier,
        model: resolved.model,
        provider: resolved.provider,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        status: 'error',
        promptLength: request.prompt.length + (request.systemPrompt?.length ?? 0),
        responseLength: 0,
      });
    } catch { /* telemetry should never break LLM calls */ }

    throw error;
  }
}

// ============================================================================
// API Key Management
// ============================================================================

function getApiKey(provider: ConcreteProvider): string {
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

  if (provider === 'anthropic') {
    const key = settings.providers.anthropic.apiKey;
    if (!key) {
      throw new Error('Anthropic API key not configured. Set it in Settings.');
    }
    return key;
  }

  if (provider === 'openai') {
    const key = settings.providers.openai.apiKey;
    if (!key) {
      throw new Error('OpenAI API key not configured. Set it in Settings.');
    }
    return key;
  }

  throw new Error(`Unknown provider: ${provider}`);
}
