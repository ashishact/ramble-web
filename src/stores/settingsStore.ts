/**
 * Settings Store - API keys and app configuration
 *
 * Uses plain localStorage for simple persistence.
 */

import { z } from 'zod/v4';
import {
  LLMTierSettingsSchema,
  STTTierSettingsSchema,
  DEFAULT_LLM_TIER_SETTINGS,
  DEFAULT_STT_TIER_SETTINGS,
} from '../program/types/llmTiers';

// Schema for app settings
export const appSettingsSchema = z.object({
  id: z.literal('app-settings'),
  providers: z.object({
    gemini: z.object({
      apiKey: z.string().default(''),
      model: z.string().default('models/gemini-2.5-flash-native-audio-preview-09-2025'),
      enabled: z.boolean().default(false),
    }),
    anthropic: z.object({
      apiKey: z.string().default(''),
      model: z.string().default('claude-sonnet-4-20250514'),
      enabled: z.boolean().default(false),
    }),
    openai: z.object({
      apiKey: z.string().default(''),
      model: z.string().default('gpt-4o'),
      enabled: z.boolean().default(false),
    }),
    groq: z.object({
      apiKey: z.string().default(''),
      model: z.string().default('openai/gpt-oss-120b'),
      enabled: z.boolean().default(false),
    }),
    deepgram: z.object({
      apiKey: z.string().default(''),
      model: z.string().default('nova-3'),
      enabled: z.boolean().default(false),
    }),
  }),
  // LLM tier mappings - application uses tiers, settings define which provider/model for each tier
  llmTiers: LLMTierSettingsSchema.default(DEFAULT_LLM_TIER_SETTINGS),
  // STT tier mappings
  sttTiers: STTTierSettingsSchema.default(DEFAULT_STT_TIER_SETTINGS),
  voiceProvider: z.literal('gemini').default('gemini'),
  observerProvider: z.enum(['gemini', 'anthropic', 'openai', 'groq']).default('gemini'),
  voice: z.object({
    name: z.enum(['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Zephyr']).default('Aoede'),
    silenceDurationMs: z.number().default(800),
    prefixPaddingMs: z.number().default(300),
  }),
  currentNodeId: z.number().nullable().default(null),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    showTranscripts: z.boolean().default(true),
  }),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

const STORAGE_KEY = 'amigoz-settings';

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  id: 'app-settings',
  providers: {
    gemini: { apiKey: '', model: 'models/gemini-2.5-flash-native-audio-preview-09-2025', enabled: false },
    anthropic: { apiKey: '', model: 'claude-sonnet-4-20250514', enabled: false },
    openai: { apiKey: '', model: 'gpt-4o', enabled: false },
    groq: { apiKey: '', model: 'openai/gpt-oss-120b', enabled: false },
    deepgram: { apiKey: '', model: 'nova-3', enabled: false },
  },
  llmTiers: DEFAULT_LLM_TIER_SETTINGS,
  sttTiers: DEFAULT_STT_TIER_SETTINGS,
  voiceProvider: 'gemini',
  observerProvider: 'gemini',
  voice: {
    name: 'Aoede',
    silenceDurationMs: 800,
    prefixPaddingMs: 300,
  },
  currentNodeId: null,
  ui: {
    theme: 'system',
    showTranscripts: true,
  },
};

// Load settings from localStorage
const loadSettings = (): AppSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);

      // Deep merge providers to ensure new providers are added
      const mergedProviders = {
        ...DEFAULT_SETTINGS.providers,
        ...parsed.providers,
      };

      // Merge with defaults to handle any missing fields
      const merged = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        providers: mergedProviders,
      };

      // Migrate deprecated Gemini models to production stable versions
      let needsSave = false;
      if (merged.providers?.gemini?.model === 'gemini-live-2.5-flash-preview' ||
          merged.providers?.gemini?.model === 'gemini-live-2.5-flash' ||
          merged.providers?.gemini?.model === 'gemini-2.5-flash') {
        merged.providers.gemini.model = 'models/gemini-2.5-flash-native-audio-preview-09-2025';
        needsSave = true;
      }

      // Check if deepgram provider was just added
      if (!parsed.providers?.deepgram) {
        needsSave = true;
        console.log('[Settings] Added new Deepgram provider to settings');
      }

      if (needsSave) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }

      return merged;
    }
  } catch (e) {
    console.warn('[Settings] Failed to load from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
};

// Save settings to localStorage
const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[Settings] Failed to save to localStorage:', e);
  }
};

// In-memory cache
let cachedSettings: AppSettings = loadSettings();

// Listeners for reactivity
type SettingsListener = (settings: AppSettings) => void;
const listeners = new Set<SettingsListener>();

const notifyListeners = () => {
  listeners.forEach(listener => listener(cachedSettings));
};

// Helper functions for settings operations
export const settingsHelpers = {
  getSettings: (): AppSettings => {
    return cachedSettings;
  },

  subscribe: (listener: SettingsListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // API Key operations
  setApiKey: (provider: keyof AppSettings['providers'], apiKey: string) => {
    cachedSettings = {
      ...cachedSettings,
      providers: {
        ...cachedSettings.providers,
        [provider]: {
          ...cachedSettings.providers[provider],
          apiKey,
          enabled: apiKey.length > 0,
        },
      },
    };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  getApiKey: (provider: keyof AppSettings['providers']): string => {
    return cachedSettings.providers[provider].apiKey;
  },

  isProviderConfigured: (provider: keyof AppSettings['providers']): boolean => {
    return cachedSettings.providers[provider].apiKey.length > 0;
  },

  // Provider selection
  setObserverProvider: (provider: AppSettings['observerProvider']) => {
    cachedSettings = { ...cachedSettings, observerProvider: provider };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  // Voice settings
  setVoiceName: (name: AppSettings['voice']['name']) => {
    cachedSettings = {
      ...cachedSettings,
      voice: { ...cachedSettings.voice, name },
    };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  setVadSettings: (settings: Partial<AppSettings['voice']>) => {
    cachedSettings = {
      ...cachedSettings,
      voice: { ...cachedSettings.voice, ...settings },
    };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  // Current node
  setCurrentNodeId: (nodeId: number | null) => {
    cachedSettings = { ...cachedSettings, currentNodeId: nodeId };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  getCurrentNodeId: (): number | null => {
    return cachedSettings.currentNodeId;
  },

  // UI preferences
  setTheme: (theme: AppSettings['ui']['theme']) => {
    cachedSettings = {
      ...cachedSettings,
      ui: { ...cachedSettings.ui, theme },
    };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  // Reset to defaults
  reset: () => {
    cachedSettings = { ...DEFAULT_SETTINGS };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  // LLM Tier settings
  getLLMTiers: () => cachedSettings.llmTiers,

  setLLMTiers: (llmTiers: AppSettings['llmTiers']) => {
    cachedSettings = { ...cachedSettings, llmTiers };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  // STT Tier settings
  getSTTTiers: () => cachedSettings.sttTiers,

  setSTTTiers: (sttTiers: AppSettings['sttTiers']) => {
    cachedSettings = { ...cachedSettings, sttTiers };
    saveSettings(cachedSettings);
    notifyListeners();
  },
};

// Export simple getter for use in non-reactive contexts
export const getSettings = (): AppSettings => cachedSettings;
