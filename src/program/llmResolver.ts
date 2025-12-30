/**
 * LLM Tier Resolver
 *
 * Resolves abstract LLM tiers (small/medium/large) to concrete provider+model.
 */

import {
  type LLMTier,
  type LLMTierConfig,
  type LLMTierSettings,
  type STTTier,
  type STTTierConfig,
  type STTTierSettings,
  DEFAULT_LLM_TIER_SETTINGS,
  DEFAULT_STT_TIER_SETTINGS,
} from './types/llmTiers';

// Settings storage key
const LLM_TIER_SETTINGS_KEY = 'llm_tier_settings';

/**
 * Get LLM tier settings from localStorage
 */
export function getLLMTierSettings(): LLMTierSettings {
  try {
    const stored = localStorage.getItem(LLM_TIER_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse LLM tier settings:', e);
  }
  return DEFAULT_LLM_TIER_SETTINGS;
}

/**
 * Save LLM tier settings to localStorage
 */
export function saveLLMTierSettings(settings: LLMTierSettings): void {
  localStorage.setItem(LLM_TIER_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Update a single tier's settings
 */
export function updateLLMTier(tier: LLMTier, config: LLMTierConfig): void {
  const settings = getLLMTierSettings();
  settings[tier] = config;
  saveLLMTierSettings(settings);
}

/**
 * Update all tier settings at once
 */
export function updateLLMTierSettings(settings: LLMTierSettings): void {
  saveLLMTierSettings(settings);
}

/**
 * Reset a tier to default
 */
export function resetLLMTier(tier: LLMTier): void {
  const settings = getLLMTierSettings();
  settings[tier] = DEFAULT_LLM_TIER_SETTINGS[tier];
  saveLLMTierSettings(settings);
}

/**
 * Resolve an LLM tier to a concrete provider and model
 */
export function resolveLLMTier(tier: LLMTier): LLMTierConfig {
  const settings = getLLMTierSettings();
  return settings[tier];
}

// ============================================================================
// STT Tier Resolver
// ============================================================================

const STT_TIER_SETTINGS_KEY = 'stt_tier_settings';

/**
 * Get STT tier settings from localStorage
 */
export function getSTTTierSettings(): STTTierSettings {
  try {
    const stored = localStorage.getItem(STT_TIER_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse STT tier settings:', e);
  }
  return DEFAULT_STT_TIER_SETTINGS;
}

/**
 * Save STT tier settings to localStorage
 */
export function saveSTTTierSettings(settings: STTTierSettings): void {
  localStorage.setItem(STT_TIER_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Update all STT tier settings at once
 */
export function updateSTTTierSettings(settings: STTTierSettings): void {
  saveSTTTierSettings(settings);
}

/**
 * Reset a STT tier to default
 */
export function resetSTTTier(tier: STTTier): void {
  const settings = getSTTTierSettings();
  settings[tier] = DEFAULT_STT_TIER_SETTINGS[tier];
  saveSTTTierSettings(settings);
}

/**
 * Resolve an STT tier to a concrete provider and model
 */
export function resolveSTTTier(tier: STTTier): STTTierConfig {
  const settings = getSTTTierSettings();
  return settings[tier];
}
