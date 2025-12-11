/**
 * LLM Tier Settings Panel
 *
 * Configure which provider/model backs each LLM tier (small/medium/large)
 */

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import {
  getLLMTierSettings,
  updateLLMTierSettings,
  resetLLMTier,
  DEFAULT_LLM_TIER_SETTINGS,
  LLM_TIER_INFO,
  type LLMTier,
  type LLMTierSettings,
  type ConcreteProvider as LLMProvider,
} from '../../program';

const AVAILABLE_PROVIDERS: Array<{ value: LLMProvider; label: string }> = [
  { value: 'groq', label: 'Groq' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' },
];

const COMMON_MODELS: Record<LLMProvider, string[]> = {
  groq: ['groq/openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  gemini: ['google/gemini-2.5-flash', 'google/gemini-2.5-pro', 'google/gemini-1.5-pro'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
};

export function LLMTierPanel() {
  const [tierSettings, setTierSettings] = useState<LLMTierSettings>(getLLMTierSettings);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setTierSettings(getLLMTierSettings());
  }, []);

  const handleProviderChange = (tier: LLMTier, provider: LLMProvider) => {
    const newSettings = {
      ...tierSettings,
      [tier]: {
        ...tierSettings[tier],
        provider,
        model: COMMON_MODELS[provider][0], // Set first model as default
      },
    };
    setTierSettings(newSettings);
    setHasChanges(true);
  };

  const handleModelChange = (tier: LLMTier, model: string) => {
    const newSettings = {
      ...tierSettings,
      [tier]: {
        ...tierSettings[tier],
        model,
      },
    };
    setTierSettings(newSettings);
    setHasChanges(true);
  };

  const handleSave = () => {
    updateLLMTierSettings(tierSettings);
    setHasChanges(false);
  };

  const handleReset = (tier: LLMTier) => {
    resetLLMTier(tier);
    setTierSettings(getLLMTierSettings());
    setHasChanges(false);
  };

  const handleResetAll = () => {
    updateLLMTierSettings(DEFAULT_LLM_TIER_SETTINGS);
    setTierSettings(DEFAULT_LLM_TIER_SETTINGS);
    setHasChanges(false);
  };

  const tiers: LLMTier[] = ['small', 'medium', 'large'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">LLM Tier Configuration</h2>
          <p className="text-sm text-base-content/60 mt-1">
            Map intelligence tiers to specific LLM providers. All extractors use these tiers instead of hardcoded providers.
          </p>
        </div>
        <button
          onClick={handleResetAll}
          className="btn btn-outline btn-sm gap-2"
        >
          <Icon icon="mdi:restore" className="w-4 h-4" />
          Reset All
        </button>
      </div>

      <div className="space-y-4">
        {tiers.map((tier) => {
          const tierInfo = LLM_TIER_INFO[tier];
          const config = tierSettings[tier];
          const availableModels = COMMON_MODELS[config.provider];

          return (
            <div key={tier} className="card bg-base-200 shadow-sm">
              <div className="card-body">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{tierInfo.icon}</span>
                    <div>
                      <h3 className="font-semibold text-lg">{tierInfo.name} Tier</h3>
                      <p className="text-sm text-base-content/60">{tierInfo.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleReset(tier)}
                    className="btn btn-ghost btn-xs gap-1"
                  >
                    <Icon icon="mdi:restore" className="w-3 h-3" />
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Provider Selection */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Provider</span>
                    </label>
                    <select
                      value={config.provider}
                      onChange={(e) => handleProviderChange(tier, e.target.value as LLMProvider)}
                      className="select select-bordered w-full"
                    >
                      {AVAILABLE_PROVIDERS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model Selection */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Model</span>
                    </label>
                    <select
                      value={config.model}
                      onChange={(e) => handleModelChange(tier, e.target.value)}
                      className="select select-bordered w-full"
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model.split('/').pop()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Current Full Model Path */}
                <div className="mt-2">
                  <p className="text-xs text-base-content/50">
                    Full path: <code className="bg-base-300 px-2 py-0.5 rounded">{config.model}</code>
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="alert alert-info">
          <Icon icon="mdi:information" className="w-5 h-5" />
          <span>You have unsaved changes</span>
          <button onClick={handleSave} className="btn btn-primary btn-sm">
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
