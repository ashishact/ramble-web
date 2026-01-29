/**
 * API Key Testing Utility
 *
 * Tests API keys by making a simple request through the CloudFlare Gateway
 */

import { callLLM } from '../../../program/llmClient'

export interface ApiKeyTestResult {
  success: boolean
  error?: string
  latencyMs?: number
}

/**
 * Test a Gemini API key by making a simple request
 */
export async function testGeminiApiKey(apiKey: string): Promise<ApiKeyTestResult> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { success: false, error: 'API key is empty' }
  }

  const startTime = performance.now()

  try {
    // Make a simple test request
    const response = await callLLM({
      tier: 'small',
      prompt: 'Say "Hello" in one word.',
      systemPrompt: 'You are a helpful assistant. Respond with just one word.',
      options: {
        temperature: 0,
        max_tokens: 10,
      },
    })

    const latencyMs = Math.round(performance.now() - startTime)

    // Check if we got a valid response
    if (response.content && response.content.length > 0) {
      return { success: true, latencyMs }
    }

    return { success: false, error: 'Empty response from API' }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check for common error types
    if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('invalid')) {
      return { success: false, error: 'Invalid API key', latencyMs }
    }
    if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
      return { success: false, error: 'Rate limit exceeded. Try again later.', latencyMs }
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return { success: false, error: 'Network error. Check your connection.', latencyMs }
    }

    return { success: false, error: errorMessage, latencyMs }
  }
}

/**
 * Validate API key format (basic check before making request)
 */
export function validateApiKeyFormat(apiKey: string, provider: 'gemini'): { valid: boolean; error?: string } {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: 'API key is required' }
  }

  const trimmed = apiKey.trim()

  if (provider === 'gemini') {
    // Gemini API keys typically start with "AIza" and are ~39 characters
    if (trimmed.length < 30) {
      return { valid: false, error: 'API key seems too short' }
    }
    if (!trimmed.startsWith('AIza')) {
      return { valid: false, error: 'Gemini API keys should start with "AIza"' }
    }
  }

  return { valid: true }
}
