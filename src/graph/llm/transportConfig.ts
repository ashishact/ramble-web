/**
 * Transport Configuration — API vs Extension
 *
 * Different context budgets depending on whether we're calling
 * through the API (high budget) or browser extension (low budget).
 */

export interface TransportConfig {
  /** Maximum characters for the full conversation (system + messages) */
  maxContextChars: number
  /** Maximum output tokens for the LLM response */
  maxOutputTokens: number
  /** LLM tier to use ('small' | 'medium' | 'large') */
  tier: 'small' | 'medium' | 'large'
}

/** API transport — full budget through Cloudflare Gateway */
export const API_TRANSPORT: TransportConfig = {
  maxContextChars: 100_000,
  maxOutputTokens: 4000,
  tier: 'medium',
}

/** Extension transport — constrained budget through browser extension */
export const EXTENSION_TRANSPORT: TransportConfig = {
  maxContextChars: 20_000,
  maxOutputTokens: 2000,
  tier: 'small',
}

/**
 * Get the appropriate transport config.
 * For now, default to API. Extension detection will be added later.
 */
export function getTransportConfig(): TransportConfig {
  return API_TRANSPORT
}
