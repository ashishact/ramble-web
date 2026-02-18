/**
 * LLM Tier Abstraction
 *
 * Provides application-level abstraction over LLM providers.
 * Users select intelligence tiers (small/medium/large) instead of specific providers.
 * Settings determine which provider backs each tier.
 */

import { z } from 'zod';

// ============================================================================
// LLM Tiers
// ============================================================================

/**
 * LLM intelligence tiers
 * - small: Fast, cheap, good for simple extractions (groq/gemini-flash/haiku)
 * - medium: Balanced intelligence and speed (gemini-flash/sonnet)
 * - large: Highest intelligence, slower, expensive (gemini-pro/opus)
 */
export const LLMTierSchema = z.enum(['small', 'medium', 'large']);
export type LLMTier = z.infer<typeof LLMTierSchema>;

/**
 * Concrete LLM providers
 */
export const LLMProviderSchema = z.enum(['groq', 'gemini', 'anthropic', 'openai']);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

/**
 * LLM tier configuration - maps tier to concrete provider+model
 */
export const LLMTierConfigSchema = z.object({
  provider: LLMProviderSchema,
  model: z.string(),
});
export type LLMTierConfig = z.infer<typeof LLMTierConfigSchema>;

/**
 * Settings for all LLM tiers
 */
export const LLMTierSettingsSchema = z.object({
  small: LLMTierConfigSchema,
  medium: LLMTierConfigSchema,
  large: LLMTierConfigSchema,
});
export type LLMTierSettings = z.infer<typeof LLMTierSettingsSchema>;

// ============================================================================
// STT Tiers
// ============================================================================

/**
 * Speech-to-Text tiers
 * - small: Fast transcription, basic accuracy (groq-whisper)
 * - medium: Better accuracy, still fast (gemini-flash)
 * - large: Best accuracy for batch (gemini-pro)
 * - live: Real-time streaming (deepgram)
 */
export const STTTierSchema = z.enum(['small', 'medium', 'large', 'live']);
export type STTTier = z.infer<typeof STTTierSchema>;

/**
 * Concrete STT providers
 */
export const STTProviderSchema = z.enum([
  'groq-whisper',
  'deepgram-nova',
  'deepgram-flux',
  'gemini',
  'mistral',
]);
export type STTProvider = z.infer<typeof STTProviderSchema>;

/**
 * STT tier configuration
 */
export const STTTierConfigSchema = z.object({
  provider: STTProviderSchema,
  model: z.string().optional(),
});
export type STTTierConfig = z.infer<typeof STTTierConfigSchema>;

/**
 * Settings for all STT tiers
 */
export const STTTierSettingsSchema = z.object({
  small: STTTierConfigSchema,
  medium: STTTierConfigSchema,
  large: STTTierConfigSchema,
  live: STTTierConfigSchema,
});
export type STTTierSettings = z.infer<typeof STTTierSettingsSchema>;

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default LLM tier mappings
 */
export const DEFAULT_LLM_TIER_SETTINGS: LLMTierSettings = {
  small: {
    provider: 'groq',
    model: 'groq/openai/gpt-oss-120b',
  },
  medium: {
    provider: 'gemini',
    model: 'google/gemini-2.5-flash',
  },
  large: {
    provider: 'gemini',
    model: 'google/gemini-2.5-pro',
  },
};

/**
 * Default STT tier mappings
 */
export const DEFAULT_STT_TIER_SETTINGS: STTTierSettings = {
  small: {
    provider: 'groq-whisper',
    model: 'whisper-large-v3',
  },
  medium: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
  },
  large: {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
  },
  live: {
    provider: 'deepgram-nova',
    model: 'nova-2',
  },
};

/**
 * Provider display names
 */
export const PROVIDER_DISPLAY_NAMES: Record<LLMProvider | STTProvider, string> = {
  groq: 'Groq',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  'groq-whisper': 'Groq Whisper',
  'deepgram-nova': 'Deepgram Nova',
  'deepgram-flux': 'Deepgram Flux',
  'mistral': 'Mistral Voxtral',
};

/**
 * Tier characteristics for UI display
 */
export const LLM_TIER_INFO: Record<
  LLMTier,
  { name: string; description: string; icon: string }
> = {
  small: {
    name: 'Small',
    description: 'Fast and efficient for simple tasks',
    icon: '⚡',
  },
  medium: {
    name: 'Medium',
    description: 'Balanced intelligence and speed',
    icon: '🎯',
  },
  large: {
    name: 'Large',
    description: 'Maximum intelligence for complex reasoning',
    icon: '🧠',
  },
};

export const STT_TIER_INFO: Record<
  STTTier,
  { name: string; description: string; icon: string }
> = {
  small: {
    name: 'Small',
    description: 'Fast transcription with basic accuracy',
    icon: '⚡',
  },
  medium: {
    name: 'Medium',
    description: 'Better accuracy, still fast',
    icon: '🎯',
  },
  large: {
    name: 'Large',
    description: 'Best accuracy for batch processing',
    icon: '🧠',
  },
  live: {
    name: 'Live',
    description: 'Real-time streaming transcription',
    icon: '🎙️',
  },
};
