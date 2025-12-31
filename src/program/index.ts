/**
 * Program Module Exports
 *
 * Core Loop Architecture
 */

// Kernel
export {
  getKernel,
  type KernelState,
  type InputResult,
  processInput,
  type ProcessingResult,
  buildContext,
  formatContextForLLM,
  type Context,
} from './kernel';

// LLM Client
export { callLLM, type LLMRequest, type LLMResponse } from './llmClient';

// LLM Tier Resolver
export {
  getLLMTierSettings,
  saveLLMTierSettings,
  updateLLMTierSettings,
  resetLLMTier,
  resolveLLMTier,
  // STT Tier Resolver
  getSTTTierSettings,
  saveSTTTierSettings,
  updateSTTTierSettings,
  resetSTTTier,
  resolveSTTTier,
} from './llmResolver';

// LLM Types
export {
  type LLMTier,
  type LLMProvider,
  type LLMTierConfig,
  type LLMTierSettings,
  type STTTier,
  type STTProvider,
  type STTTierConfig,
  type STTTierSettings,
  DEFAULT_LLM_TIER_SETTINGS,
  DEFAULT_STT_TIER_SETTINGS,
  LLM_TIER_INFO,
  STT_TIER_INFO,
  PROVIDER_DISPLAY_NAMES,
} from './types/llmTiers';

// Type aliases for backward compatibility
export type { LLMProvider as ConcreteProvider } from './types/llmTiers';
export type { STTProvider as ConcreteSTTProvider } from './types/llmTiers';

// Utils
export { createLogger } from './utils/logger';
export { generateId } from './utils/id';
export { now, formatRelativeTime } from './utils/time';
