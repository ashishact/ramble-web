/**
 * STT Tier Settings Panel
 *
 * Configure which provider backs each STT tier (small/medium/large/live)
 */

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import {
  getSTTTierSettings,
  updateSTTTierSettings,
  resetSTTTier,
  DEFAULT_STT_TIER_SETTINGS,
  STT_TIER_INFO,
  type STTTier,
  type STTTierSettings,
  type ConcreteSTTProvider,
} from '../../../program';

const AVAILABLE_STT_PROVIDERS: Array<{ value: ConcreteSTTProvider; label: string }> = [
  { value: 'groq-whisper', label: 'Groq Whisper' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepgram-nova', label: 'Deepgram Nova (v1)' },
  { value: 'deepgram-flux', label: 'Deepgram Flux (v2)' },
];

const STT_MODELS: Record<ConcreteSTTProvider, string[]> = {
  'groq-whisper': ['whisper-large-v3', 'whisper-large-v3-turbo'],
  'gemini': ['gemini-2.5-flash', 'gemini-2.5-pro'],
  'deepgram-nova': ['nova-2', 'nova-3'],
  'deepgram-flux': ['flux-general-en', 'flux-medical-en'],
};

export function STTTierPanel() {
  const [tierSettings, setTierSettings] = useState<STTTierSettings>(getSTTTierSettings);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setTierSettings(getSTTTierSettings());
  }, []);

  const showSaved = () => {
    setSavedMessage('Saved');
    setTimeout(() => setSavedMessage(null), 1500);
  };

  const handleProviderChange = (tier: STTTier, provider: ConcreteSTTProvider) => {
    const newSettings = {
      ...tierSettings,
      [tier]: {
        ...tierSettings[tier],
        provider,
        model: STT_MODELS[provider][0], // Set first model as default
      },
    };
    setTierSettings(newSettings);
    updateSTTTierSettings(newSettings);
    showSaved();
  };

  const handleModelChange = (tier: STTTier, model: string) => {
    const newSettings = {
      ...tierSettings,
      [tier]: {
        ...tierSettings[tier],
        model,
      },
    };
    setTierSettings(newSettings);
    updateSTTTierSettings(newSettings);
    showSaved();
  };

  const handleReset = (tier: STTTier) => {
    resetSTTTier(tier);
    setTierSettings(getSTTTierSettings());
    showSaved();
  };

  const handleResetAll = () => {
    updateSTTTierSettings(DEFAULT_STT_TIER_SETTINGS);
    setTierSettings(DEFAULT_STT_TIER_SETTINGS);
    showSaved();
  };

  const tiers: STTTier[] = ['small', 'medium', 'large', 'live'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">STT Tier Configuration</h2>
          <p className="text-sm text-base-content/60 mt-1">
            Map speech-to-text tiers to specific STT providers. Use tiers in your app instead of hardcoded providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedMessage && (
            <span className="badge badge-success gap-1">
              <Icon icon="mdi:check" className="w-3 h-3" />
              {savedMessage}
            </span>
          )}
          <button
            onClick={handleResetAll}
            className="btn btn-outline btn-sm gap-2"
          >
            <Icon icon="mdi:restore" className="w-4 h-4" />
            Reset All
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {tiers.map((tier) => {
          const tierInfo = STT_TIER_INFO[tier];
          const config = tierSettings[tier];
          const availableModels = STT_MODELS[config.provider];

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
                      onChange={(e) => handleProviderChange(tier, e.target.value as ConcreteSTTProvider)}
                      className="select select-bordered w-full"
                    >
                      {AVAILABLE_STT_PROVIDERS.map(({ value, label }) => (
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
                      value={config.model || availableModels[0]}
                      onChange={(e) => handleModelChange(tier, e.target.value)}
                      className="select select-bordered w-full"
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Current Configuration */}
                <div className="mt-2">
                  <p className="text-xs text-base-content/50">
                    Provider: <code className="bg-base-300 px-2 py-0.5 rounded">{config.provider}</code>
                    {config.model && (
                      <>
                        {' '} Model: <code className="bg-base-300 px-2 py-0.5 rounded">{config.model}</code>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
