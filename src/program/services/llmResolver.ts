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
import { getSettings } from '../../stores/settingsStore';

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
  const settings = getSettings();
  const tierSettings: LLMTierSettings =
    settings.llmTiers || DEFAULT_LLM_TIER_SETTINGS;

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
  const settings = getSettings();
  return settings.llmTiers || DEFAULT_LLM_TIER_SETTINGS;
}

/**
 * Update LLM tier settings
 */
export function updateLLMTierSettings(tierSettings: Partial<LLMTierSettings>): void {
  const settings = getSettings();
  const currentTierSettings = settings.llmTiers || DEFAULT_LLM_TIER_SETTINGS;

  const updatedSettings = {
    ...settings,
    llmTiers: {
      ...currentTierSettings,
      ...tierSettings,
    },
  };

  localStorage.setItem('appSettings', JSON.stringify(updatedSettings));
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
  const settings = getSettings();
  const tierSettings: STTTierSettings =
    settings.sttTiers || DEFAULT_STT_TIER_SETTINGS;

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
  const settings = getSettings();
  return settings.sttTiers || DEFAULT_STT_TIER_SETTINGS;
}

/**
 * Update STT tier settings
 */
export function updateSTTTierSettings(tierSettings: Partial<STTTierSettings>): void {
  const settings = getSettings();
  const currentTierSettings = settings.sttTiers || DEFAULT_STT_TIER_SETTINGS;

  const updatedSettings = {
    ...settings,
    sttTiers: {
      ...currentTierSettings,
      ...tierSettings,
    },
  };

  localStorage.setItem('appSettings', JSON.stringify(updatedSettings));
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
  context_tokens: number;
  max_claims: number;
  max_entities: number;
} {
  // Map tier to budget based on capabilities
  switch (tier) {
    case 'small':
      return {
        context_tokens: 4000,
        max_claims: 10,
        max_entities: 5,
      };
    case 'medium':
      return {
        context_tokens: 8000,
        max_claims: 20,
        max_entities: 10,
      };
    case 'large':
      return {
        context_tokens: 16000,
        max_claims: 50,
        max_entities: 20,
      };
  }
}
