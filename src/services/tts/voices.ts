/**
 * Kokoro TTS v1.0 Voice Definitions
 * Based on actual available voices from the model
 */

export type LanguageCode = 'en-us' | 'en-gb';
export type Gender = 'male' | 'female';

export interface VoiceDefinition {
  id: string;
  name: string;
  language: LanguageCode;
  languageName: string;
  gender: Gender;
}

// Actual voices available in onnx-community/Kokoro-82M-v1.0-ONNX
export const voices: VoiceDefinition[] = [
  // American English Female
  { id: 'af_alloy', name: 'Alloy', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_aoede', name: 'Aoede', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_bella', name: 'Bella', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_heart', name: 'Heart', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_jessica', name: 'Jessica', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_kore', name: 'Kore', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_nicole', name: 'Nicole', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_nova', name: 'Nova', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_river', name: 'River', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_sarah', name: 'Sarah', language: 'en-us', languageName: 'English (US)', gender: 'female' },
  { id: 'af_sky', name: 'Sky', language: 'en-us', languageName: 'English (US)', gender: 'female' },

  // American English Male
  { id: 'am_adam', name: 'Adam', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_echo', name: 'Echo', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_eric', name: 'Eric', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_fenrir', name: 'Fenrir', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_liam', name: 'Liam', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_michael', name: 'Michael', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_onyx', name: 'Onyx', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_puck', name: 'Puck', language: 'en-us', languageName: 'English (US)', gender: 'male' },
  { id: 'am_santa', name: 'Santa', language: 'en-us', languageName: 'English (US)', gender: 'male' },

  // British English Female
  { id: 'bf_alice', name: 'Alice', language: 'en-gb', languageName: 'English (UK)', gender: 'female' },
  { id: 'bf_emma', name: 'Emma', language: 'en-gb', languageName: 'English (UK)', gender: 'female' },
  { id: 'bf_isabella', name: 'Isabella', language: 'en-gb', languageName: 'English (UK)', gender: 'female' },
  { id: 'bf_lily', name: 'Lily', language: 'en-gb', languageName: 'English (UK)', gender: 'female' },

  // British English Male
  { id: 'bm_daniel', name: 'Daniel', language: 'en-gb', languageName: 'English (UK)', gender: 'male' },
  { id: 'bm_fable', name: 'Fable', language: 'en-gb', languageName: 'English (UK)', gender: 'male' },
  { id: 'bm_george', name: 'George', language: 'en-gb', languageName: 'English (UK)', gender: 'male' },
  { id: 'bm_lewis', name: 'Lewis', language: 'en-gb', languageName: 'English (UK)', gender: 'male' },
];

// Default voice - British English Lily
export const DEFAULT_VOICE = 'bf_lily';

export function getVoiceById(id: string): VoiceDefinition | undefined {
  return voices.find(v => v.id === id);
}

export function getVoicesByLanguage(language: LanguageCode): VoiceDefinition[] {
  return voices.filter(v => v.language === language);
}

export function getLanguages(): { code: LanguageCode; name: string }[] {
  const seen = new Set<LanguageCode>();
  const result: { code: LanguageCode; name: string }[] = [];

  for (const voice of voices) {
    if (!seen.has(voice.language)) {
      seen.add(voice.language);
      result.push({ code: voice.language, name: voice.languageName });
    }
  }

  return result;
}
