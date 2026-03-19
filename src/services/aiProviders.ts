/**
 * AI SDK v6 Provider Instances — pointed at our proxy
 *
 * The AI SDK formats requests in each provider's native API spec.
 * Our proxy (/api/v1/ai-proxy/{provider}/**) forwards with API key injection.
 *
 * Auth headers are injected via a custom fetch wrapper since the provider
 * settings only accept static headers.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { getWorkerHeaders } from './cfGateway'

const PROXY_BASE = `${import.meta.env.VITE_WORKER_URL || 'http://localhost:8787'}/api/v1/ai-proxy`

/**
 * Custom fetch that injects auth headers (X-Device-ID, Authorization)
 * into every request made by the AI SDK providers.
 */
const proxyFetch: typeof globalThis.fetch = (input, init) => {
  const authHeaders = getWorkerHeaders()
  const existingHeaders = new Headers(init?.headers)
  for (const [k, v] of Object.entries(authHeaders)) {
    existingHeaders.set(k, v)
  }
  return globalThis.fetch(input, { ...init, headers: existingHeaders })
}

export const openai = createOpenAI({
  baseURL: `${PROXY_BASE}/openai/v1`,
  apiKey: 'proxy', // proxy handles real keys
  fetch: proxyFetch,
})

export const google = createGoogleGenerativeAI({
  baseURL: `${PROXY_BASE}/google/v1beta`,
  apiKey: 'proxy',
  fetch: proxyFetch,
})

export const anthropic = createAnthropic({
  baseURL: `${PROXY_BASE}/anthropic/v1`,
  apiKey: 'proxy',
  fetch: proxyFetch,
})

/** Pre-configured model references for common use cases */
export const models = {
  /** Conversation model (fast, cheap, good for real-time) */
  conversation: google('gemini-2.5-flash-lite'),
  /** Medium intelligence */
  medium: google('gemini-2.5-flash'),
  /** High intelligence */
  large: google('gemini-2.5-pro'),
}

/**
 * Resolve a model instance from a tier config (reuses existing LLMTierConfig shape).
 * Strips the provider prefix from model IDs since the AI SDK providers add their own.
 */
export function modelFromTier(config: { provider: string; model: string }) {
  const modelId = config.model.replace(/^(google|openai|anthropic|groq)\//, '')
  switch (config.provider) {
    case 'openai': return openai(modelId)
    case 'anthropic': return anthropic(modelId)
    case 'gemini': return google(modelId)
    default: return google(modelId)
  }
}
