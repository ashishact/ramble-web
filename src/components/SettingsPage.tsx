import { useState, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { settingsHelpers, type AppSettings } from '../stores/settingsStore';
import { ThemeSelector } from './ThemeSelector';

interface ProviderConfig {
  id: keyof AppSettings['providers'];
  name: string;
  icon: string;
  placeholder: string;
  helpUrl: string;
  description: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    icon: 'simple-icons:google',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Required for voice. Gemini Live for real-time voice, Gemini Flash for knowledge processing.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: 'simple-icons:anthropic',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude Sonnet 4, Claude 3 Opus. Can be used for Observer agent.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'simple-icons:openai',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT-4o, GPT-4. Can be used for Observer agent.',
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: 'simple-icons:groq',
    placeholder: 'gsk_...',
    helpUrl: 'https://console.groq.com/keys',
    description: 'Fast inference with Llama, Mixtral. Can be used for Observer agent.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    icon: 'simple-icons:deepgram',
    placeholder: 'Enter your Deepgram API key',
    helpUrl: 'https://console.deepgram.com/',
    description: 'Real-time speech-to-text with Nova-3 and Flux models. Live streaming transcription.',
  },
];

const VOICE_OPTIONS = ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Zephyr'] as const;

export function SettingsPage({ onBack }: { onBack: () => void }) {
  // Simple reactive state with subscribe pattern
  const [settings, setSettings] = useState<AppSettings>(settingsHelpers.getSettings);

  useEffect(() => {
    return settingsHelpers.subscribe(setSettings);
  }, []);

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const showSavedMessage = useCallback(() => {
    setSavedMessage('Settings saved');
    setTimeout(() => setSavedMessage(null), 2000);
  }, []);

  const handleApiKeyChange = useCallback((provider: keyof AppSettings['providers'], value: string) => {
    settingsHelpers.setApiKey(provider, value);
    showSavedMessage();
  }, [showSavedMessage]);

  const handleObserverProviderChange = useCallback((provider: AppSettings['observerProvider']) => {
    settingsHelpers.setObserverProvider(provider);
    showSavedMessage();
  }, [showSavedMessage]);

  const handleVoiceChange = useCallback((voice: AppSettings['voice']['name']) => {
    settingsHelpers.setVoiceName(voice);
    showSavedMessage();
  }, [showSavedMessage]);

  const toggleShowKey = useCallback((providerId: string) => {
    setShowKeys(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  }, []);

  const handleReset = useCallback(() => {
    if (window.confirm('Are you sure you want to reset all settings? This will clear all API keys.')) {
      settingsHelpers.reset();
      showSavedMessage();
    }
  }, [showSavedMessage]);

  const isGeminiConfigured = settings.providers.gemini.enabled;

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 border-b border-base-300 sticky top-0 z-10">
        <div className="flex-none">
          <button onClick={onBack} className="btn btn-ghost btn-sm gap-2">
            <Icon icon="mdi:arrow-left" className="w-5 h-5" />
            Back
          </button>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold px-4">Settings</h1>
        </div>
        <div className="flex-none gap-2">
          {savedMessage && (
            <div className="badge badge-success gap-1">
              <Icon icon="mdi:check" className="w-4 h-4" />
              {savedMessage}
            </div>
          )}
          <ThemeSelector />
        </div>
      </div>

      <div className="container mx-auto max-w-3xl p-6 space-y-6">
        {/* Voice Warning */}
        {!isGeminiConfigured && (
          <div className="alert alert-warning">
            <Icon icon="mdi:microphone-off" className="w-6 h-6" />
            <div>
              <h3 className="font-bold">Voice features require Gemini API key</h3>
              <p className="text-sm">Add your Google Gemini API key below to enable real-time voice conversations.</p>
            </div>
          </div>
        )}

        {/* API Keys Section */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-lg flex items-center gap-2">
              <Icon icon="mdi:key" className="w-5 h-5 text-primary" />
              API Keys
            </h2>
            <p className="text-sm text-base-content/60 mb-4">
              Configure your API keys. Gemini is required for voice. Other providers can be used for the Observer agent.
            </p>

            <div className="space-y-6">
              {PROVIDERS.map((provider) => {
                const providerSettings = settings.providers[provider.id] || { apiKey: '', enabled: false, model: '' };
                const isConfigured = providerSettings.enabled;
                const isVoiceProvider = provider.id === 'gemini';
                const isObserverProvider = settings.observerProvider === provider.id;

                return (
                  <div
                    key={provider.id}
                    className={`card bg-base-200 border-2 transition-colors ${
                      isVoiceProvider && isConfigured ? 'border-success' :
                      isObserverProvider ? 'border-primary' : 'border-transparent'
                    }`}
                  >
                    <div className="card-body p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${isConfigured ? 'bg-success/20' : 'bg-base-300'}`}>
                            <Icon
                              icon={provider.icon}
                              className={`w-6 h-6 ${isConfigured ? 'text-success' : 'text-base-content/50'}`}
                            />
                          </div>
                          <div>
                            <h3 className="font-semibold flex items-center gap-2">
                              {provider.name}
                              {isConfigured && (
                                <span className="badge badge-success badge-sm">Configured</span>
                              )}
                              {isVoiceProvider && isConfigured && (
                                <span className="badge badge-info badge-sm">Voice</span>
                              )}
                              {isObserverProvider && isConfigured && (
                                <span className="badge badge-primary badge-sm">Observer</span>
                              )}
                            </h3>
                            <p className="text-xs text-base-content/60">{provider.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <a
                            href={provider.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <Icon icon="mdi:open-in-new" className="w-4 h-4" />
                            Get Key
                          </a>
                          {isConfigured && !isObserverProvider && provider.id !== 'gemini' && provider.id !== 'deepgram' && (
                            <button
                              onClick={() => handleObserverProviderChange(provider.id as AppSettings['observerProvider'])}
                              className="btn btn-primary btn-xs"
                            >
                              Use for Observer
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="form-control mt-3">
                        <div className="join w-full">
                          <input
                            type={showKeys[provider.id] ? 'text' : 'password'}
                            placeholder={provider.placeholder}
                            value={providerSettings.apiKey}
                            onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            className="input input-bordered join-item flex-1 font-mono text-sm"
                          />
                          <button
                            onClick={() => toggleShowKey(provider.id)}
                            className="btn btn-square join-item"
                            title={showKeys[provider.id] ? 'Hide key' : 'Show key'}
                          >
                            <Icon
                              icon={showKeys[provider.id] ? 'mdi:eye-off' : 'mdi:eye'}
                              className="w-5 h-5"
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Voice Settings */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-lg flex items-center gap-2">
              <Icon icon="mdi:microphone" className="w-5 h-5 text-primary" />
              Voice Settings
            </h2>
            <p className="text-sm text-base-content/60 mb-4">
              Configure the AI voice for conversations.
            </p>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Voice</span>
              </label>
              <select
                className="select select-bordered w-full max-w-xs"
                value={settings.voice.name}
                onChange={(e) => handleVoiceChange(e.target.value as AppSettings['voice']['name'])}
                disabled={!isGeminiConfigured}
              >
                {VOICE_OPTIONS.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
              <label className="label">
                <span className="label-text-alt text-base-content/60">
                  Choose the voice personality for AI responses
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Observer Agent Settings */}
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-lg flex items-center gap-2">
              <Icon icon="mdi:brain" className="w-5 h-5 text-primary" />
              Observer Agent (System II)
            </h2>
            <p className="text-sm text-base-content/60 mb-4">
              The Observer agent processes conversations in the background and organizes knowledge.
            </p>

            <div className="flex flex-wrap gap-2">
              {PROVIDERS.filter(p => p.id !== 'deepgram').map((provider) => {
                const providerSettings = settings.providers[provider.id] || { apiKey: '', enabled: false, model: '' };
                const isConfigured = providerSettings.enabled;
                const isActive = settings.observerProvider === provider.id;

                return (
                  <button
                    key={provider.id}
                    onClick={() => isConfigured && handleObserverProviderChange(provider.id as AppSettings['observerProvider'])}
                    disabled={!isConfigured}
                    className={`btn gap-2 ${
                      isActive
                        ? 'btn-primary'
                        : isConfigured
                          ? 'btn-outline'
                          : 'btn-disabled'
                    }`}
                  >
                    <Icon icon={provider.icon} className="w-4 h-4" />
                    {provider.name}
                  </button>
                );
              })}
            </div>

            {!Object.values(settings.providers).some(p => p.enabled) && (
              <div className="alert alert-warning mt-4">
                <Icon icon="mdi:alert" className="w-5 h-5" />
                <span>No API keys configured. Add at least one API key to enable the Observer agent.</span>
              </div>
            )}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="card bg-base-100 shadow-md border border-error/20">
          <div className="card-body">
            <h2 className="card-title text-lg flex items-center gap-2 text-error">
              <Icon icon="mdi:alert-octagon" className="w-5 h-5" />
              Danger Zone
            </h2>

            <div className="flex items-center justify-between mt-2">
              <div>
                <p className="font-medium">Reset All Settings</p>
                <p className="text-sm text-base-content/60">
                  This will clear all API keys and reset settings to defaults.
                </p>
              </div>
              <button onClick={handleReset} className="btn btn-error btn-sm">
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center text-sm text-base-content/50 pb-8">
          <p>API keys are stored locally in your browser's localStorage.</p>
          <p>They are never sent to any server except directly to the provider APIs.</p>
        </div>
      </div>
    </div>
  );
}
