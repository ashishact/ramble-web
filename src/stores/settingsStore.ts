/**
 * Settings Store - App configuration
 *
 * Stores user preferences. API keys are managed server-side.
 */

import { z } from 'zod/v4';
import {
  LLMTierSettingsSchema,
  STTTierSettingsSchema,
  DEFAULT_LLM_TIER_SETTINGS,
  DEFAULT_STT_TIER_SETTINGS,
} from '../program/types/llmTiers';

export const appSettingsSchema = z.object({
  id: z.literal('app-settings'),
  llmTiers: LLMTierSettingsSchema.default(DEFAULT_LLM_TIER_SETTINGS),
  sttTiers: STTTierSettingsSchema.default(DEFAULT_STT_TIER_SETTINGS),
  currentNodeId: z.number().nullable().default(null),
  reviewEnabled: z.boolean().default(true),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

const STORAGE_KEY = 'appSettings';

const DEFAULT_SETTINGS: AppSettings = {
  id: 'app-settings',
  llmTiers: DEFAULT_LLM_TIER_SETTINGS,
  sttTiers: DEFAULT_STT_TIER_SETTINGS,
  currentNodeId: null,
  reviewEnabled: true,
};

const loadSettings = (): AppSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('[Settings] Failed to load from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
};

const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[Settings] Failed to save to localStorage:', e);
  }
};

let cachedSettings: AppSettings = loadSettings();

type SettingsListener = (settings: AppSettings) => void;
const listeners = new Set<SettingsListener>();

const notifyListeners = () => {
  listeners.forEach(listener => listener(cachedSettings));
};

export const settingsHelpers = {
  getSettings: (): AppSettings => cachedSettings,

  subscribe: (listener: SettingsListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setCurrentNodeId: (nodeId: number | null) => {
    cachedSettings = { ...cachedSettings, currentNodeId: nodeId };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  getCurrentNodeId: (): number | null => cachedSettings.currentNodeId,

  isReviewEnabled: (): boolean => cachedSettings.reviewEnabled,

  setReviewEnabled: (enabled: boolean) => {
    cachedSettings = { ...cachedSettings, reviewEnabled: enabled };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  reset: () => {
    cachedSettings = { ...DEFAULT_SETTINGS };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  getLLMTiers: () => cachedSettings.llmTiers,

  setLLMTiers: (llmTiers: AppSettings['llmTiers']) => {
    cachedSettings = { ...cachedSettings, llmTiers };
    saveSettings(cachedSettings);
    notifyListeners();
  },

  getSTTTiers: () => cachedSettings.sttTiers,

  setSTTTiers: (sttTiers: AppSettings['sttTiers']) => {
    cachedSettings = { ...cachedSettings, sttTiers };
    saveSettings(cachedSettings);
    notifyListeners();
  },
};

export const getSettings = (): AppSettings => cachedSettings;
