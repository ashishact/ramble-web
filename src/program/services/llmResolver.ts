/**
 * LLM Resolver Service
 *
 * Resolves LLM tiers (small/medium/large) to concrete providers and models
 * based on user settings.
 */

import type {
  LLMTier,
  LLMTierSettings,
  LLMProvider,
  STTTier,
  STTTierSettings,
  STTProvider,
} from '../types/llmTiers';
import {
  DEFAULT_LLM_TIER_SETTINGS,
  DEFAULT_STT_TIER_SETTINGS,
} from '../types/llmTiers';
import { settingsHelpers } from '../../stores/settingsStore';

// ============================================================================
// LLM Resolution
// ============================================================================

/**
 * Resolve LLM tier to concrete provider and model
 */
export function resolveLLMTier(tier: LLMTier): {
  provider: LLMProvider;
  model: string;
} {
  const tierSettings = settingsHelpers.getLLMTiers() || DEFAULT_LLM_TIER_SETTINGS;
  const config = tierSettings[tier];

  if (!config) {
    console.warn(`[LLMResolver] No config for tier ${tier}, using default`);
    return DEFAULT_LLM_TIER_SETTINGS[tier];
  }

  return {
    provider: config.provider,
    model: config.model,
  };
}

/**
 * Get LLM tier settings (for settings UI)
 */
export function getLLMTierSettings(): LLMTierSettings {
  return settingsHelpers.getLLMTiers() || DEFAULT_LLM_TIER_SETTINGS;
}

/**
 * Update LLM tier settings
 */
export function updateLLMTierSettings(tierSettings: Partial<LLMTierSettings>): void {
  const currentTierSettings = settingsHelpers.getLLMTiers() || DEFAULT_LLM_TIER_SETTINGS;
  settingsHelpers.setLLMTiers({
    ...currentTierSettings,
    ...tierSettings,
  });
}

/**
 * Reset LLM tier to default
 */
export function resetLLMTier(tier: LLMTier): void {
  updateLLMTierSettings({
    [tier]: DEFAULT_LLM_TIER_SETTINGS[tier],
  });
}

// ============================================================================
// STT Resolution
// ============================================================================

/**
 * Resolve STT tier to concrete provider and model
 */
export function resolveSTTTier(tier: STTTier): {
  provider: STTProvider;
  model?: string;
} {
  const tierSettings = settingsHelpers.getSTTTiers() || DEFAULT_STT_TIER_SETTINGS;
  const config = tierSettings[tier];

  if (!config) {
    console.warn(`[LLMResolver] No config for STT tier ${tier}, using default`);
    return DEFAULT_STT_TIER_SETTINGS[tier];
  }

  return {
    provider: config.provider,
    model: config.model,
  };
}

/**
 * Get STT tier settings (for settings UI)
 */
export function getSTTTierSettings(): STTTierSettings {
  return settingsHelpers.getSTTTiers() || DEFAULT_STT_TIER_SETTINGS;
}

/**
 * Update STT tier settings
 */
export function updateSTTTierSettings(tierSettings: Partial<STTTierSettings>): void {
  const currentTierSettings = settingsHelpers.getSTTTiers() || DEFAULT_STT_TIER_SETTINGS;
  settingsHelpers.setSTTTiers({
    ...currentTierSettings,
    ...tierSettings,
  });
}

/**
 * Reset STT tier to default
 */
export function resetSTTTier(tier: STTTier): void {
  updateSTTTierSettings({
    [tier]: DEFAULT_STT_TIER_SETTINGS[tier],
  });
}

// ============================================================================
// Token Budget Mapping
// ============================================================================

/**
 * Get token budget for LLM tier
 */
export function getTokenBudgetForTier(tier: LLMTier): {
  contextTokens: number;
  maxClaims: number;
  max_entities: number;
} {
  // Map tier to budget based on capabilities
  switch (tier) {
    case 'small':
      return {
        contextTokens: 4000,
        maxClaims: 10,
        max_entities: 5,
      };
    case 'medium':
      return {
        contextTokens: 8000,
        maxClaims: 20,
        max_entities: 10,
      };
    case 'large':
      return {
        contextTokens: 16000,
        maxClaims: 50,
        max_entities: 20,
      };
  }
}
