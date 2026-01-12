/**
 * Settings Page with Sidebar Navigation
 *
 * Organized settings with categories:
 * - API Keys
 * - LLM Tiers
 * - STT Tiers
 * - Voice
 * - Database
 * - Appearance
 * - Advanced
 */

import { useState, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { settingsHelpers, type AppSettings } from '../../stores/settingsStore';
import { ThemeSelector } from './ThemeSelector';
import { LLMTierPanel } from './settings/LLMTierPanel';
import { STTTierPanel } from './settings/STTTierPanel';
import { DATABASE_NAME } from '../../db/schema';

type SettingsCategory =
  | 'api-keys'
  | 'llm-tiers'
  | 'stt-tiers'
  | 'voice'
  | 'database'
  | 'appearance'
  | 'advanced';

interface Category {
  id: SettingsCategory;
  name: string;
  icon: string;
  description: string;
}

const CATEGORIES: Category[] = [
  {
    id: 'api-keys',
    name: 'API Keys',
    icon: 'mdi:key-variant',
    description: 'Configure provider API keys',
  },
  {
    id: 'llm-tiers',
    name: 'LLM Tiers',
    icon: 'mdi:brain',
    description: 'Map LLM intelligence tiers to providers',
  },
  {
    id: 'stt-tiers',
    name: 'STT Tiers',
    icon: 'mdi:microphone',
    description: 'Map speech-to-text tiers to providers',
  },
  {
    id: 'voice',
    name: 'Voice',
    icon: 'mdi:account-voice',
    description: 'Voice and audio settings',
  },
  {
    id: 'database',
    name: 'Database',
    icon: 'mdi:database',
    description: 'Database migrations and management',
  },
  {
    id: 'appearance',
    name: 'Appearance',
    icon: 'mdi:palette',
    description: 'Theme and UI preferences',
  },
  {
    id: 'advanced',
    name: 'Advanced',
    icon: 'mdi:cog',
    description: 'Advanced settings and danger zone',
  },
];

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

export function SettingsPageNew({ onBack }: { onBack: () => void }) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>('api-keys');
  const [settings, setSettings] = useState<AppSettings>(settingsHelpers.getSettings);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    return settingsHelpers.subscribe(setSettings);
  }, []);

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

  return (
    <div className="h-screen flex flex-col bg-base-100">
      {/* Header */}
      <div className="navbar bg-base-200 border-b border-base-300 flex-shrink-0">
        <div className="flex-none">
          <button onClick={onBack} className="btn btn-ghost btn-circle">
            <Icon icon="mdi:arrow-left" className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Settings</h1>
        </div>
        {savedMessage && (
          <div className="badge badge-success gap-2">
            <Icon icon="mdi:check" className="w-4 h-4" />
            {savedMessage}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-base-200 border-r border-base-300 overflow-y-auto">
          <div className="menu p-2">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors ${
                  selectedCategory === category.id
                    ? 'bg-primary text-primary-content'
                    : 'hover:bg-base-300'
                }`}
              >
                <Icon icon={category.icon} className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-left flex-1">
                  <div className="font-medium">{category.name}</div>
                  <div className={`text-xs mt-0.5 ${
                    selectedCategory === category.id ? 'opacity-90' : 'opacity-60'
                  }`}>
                    {category.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedCategory === 'api-keys' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">API Keys</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  Configure your API keys for various AI providers
                </p>
              </div>

              {PROVIDERS.map((provider) => {
                const config = settings.providers[provider.id];
                const isConfigured = config.enabled && config.apiKey.length > 0;

                return (
                  <div key={provider.id} className="card bg-base-200 shadow-sm">
                    <div className="card-body">
                      <div className="flex items-center gap-3 mb-2">
                        <Icon icon={provider.icon} className="w-6 h-6" />
                        <h3 className="card-title">{provider.name}</h3>
                        {isConfigured && (
                          <div className="badge badge-success gap-1">
                            <Icon icon="mdi:check-circle" className="w-3 h-3" />
                            Configured
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-base-content/60 mb-4">{provider.description}</p>

                      <div className="form-control">
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <input
                              type={showKeys[provider.id] ? 'text' : 'password'}
                              placeholder={provider.placeholder}
                              value={config.apiKey}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              className="input input-bordered w-full pr-10"
                            />
                            <button
                              onClick={() => toggleShowKey(provider.id)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-circle"
                            >
                              <Icon icon={showKeys[provider.id] ? 'mdi:eye-off' : 'mdi:eye'} className="w-4 h-4" />
                            </button>
                          </div>
                          <a
                            href={provider.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline gap-2"
                          >
                            <Icon icon="mdi:open-in-new" className="w-4 h-4" />
                            Get Key
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedCategory === 'llm-tiers' && <LLMTierPanel />}

          {selectedCategory === 'stt-tiers' && <STTTierPanel />}

          {selectedCategory === 'voice' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Voice Settings</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  Configure voice and audio preferences
                </p>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Voice Selection</h3>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">Gemini Voice</span>
                    </label>
                    <select
                      value={settings.voice.name}
                      onChange={(e) => handleVoiceChange(e.target.value as AppSettings['voice']['name'])}
                      className="select select-bordered"
                    >
                      {VOICE_OPTIONS.map((voice) => (
                        <option key={voice} value={voice}>{voice}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Observer Provider</h3>
                  <p className="text-sm text-base-content/60 mb-4">
                    Which LLM provider to use for the Observer agent
                  </p>
                  <div className="form-control">
                    <select
                      value={settings.observerProvider}
                      onChange={(e) => handleObserverProviderChange(e.target.value as AppSettings['observerProvider'])}
                      className="select select-bordered"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="openai">OpenAI GPT</option>
                      <option value="groq">Groq</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedCategory === 'database' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Database Management</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  View database information
                </p>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Database Info</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Database Name:</span>
                      <span className="font-mono">{DATABASE_NAME}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Storage:</span>
                      <span className="font-mono">IndexedDB (WatermelonDB)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Tables</h3>
                  <div className="text-sm text-base-content/60 space-y-1">
                    <p><strong>Core:</strong> sessions, conversations, tasks</p>
                    <p><strong>Knowledge:</strong> entities, topics, memories, insights, goals</p>
                    <p><strong>System:</strong> plugins, corrections, extraction_logs</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedCategory === 'appearance' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Appearance</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  Customize the look and feel of the application
                </p>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Theme</h3>
                  <ThemeSelector />
                </div>
              </div>
            </div>
          )}

          {selectedCategory === 'advanced' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Advanced Settings</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  Dangerous operations and system controls
                </p>
              </div>

              <div className="card bg-base-100 shadow-md border border-error/20">
                <div className="card-body">
                  <h2 className="card-title text-lg flex items-center gap-2 text-error">
                    <Icon icon="mdi:alert-octagon" className="w-5 h-5" />
                    Danger Zone
                  </h2>
                  <p className="text-sm text-base-content/60 mb-4">
                    These actions cannot be undone.
                  </p>
                  <button onClick={handleReset} className="btn btn-error gap-2">
                    <Icon icon="mdi:restore" className="w-5 h-5" />
                    Reset All Settings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
