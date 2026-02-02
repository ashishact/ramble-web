/**
 * TTS Event Types - NOT lazy loaded so other widgets can import just the types
 */

export type TTSPlaybackMode = 'replace' | 'queue';

export interface TTSSpeakEvent {
  text: string;
  voice?: string;
  mode?: TTSPlaybackMode;
}

export type TTSPlaybackState =
  | 'idle'
  | 'loading-model'
  | 'generating'
  | 'playing'
  | 'paused';

export interface TTSProgressInfo {
  type: 'model-download' | 'generation';
  progress: number;
  message?: string;
}

export interface TTSConfig {
  voice?: string;
  speed?: number;
}

export interface TTSPart {
  id: string;
  text: string;
  isFirstInParagraph: boolean; // True if this is the first chunk in a paragraph
  audio?: {
    element: HTMLAudioElement;
    blob: Blob;
  };
}

export interface TTSCallbacks {
  onStateChange?: (state: TTSPlaybackState) => void;
  onProgress?: (progress: TTSProgressInfo) => void;
  onWordHighlight?: (index: number, word: string) => void;
  onPartChange?: (partId: string, parts: TTSPart[]) => void;
  onQueueChange?: (length: number) => void;
  onError?: (error: Error) => void;
}

export interface QueuedItem {
  text: string;
  voice: string;
}

// Window event type augmentation for eventBus CustomEvents
// Internal code uses eventBus.emit(), but these dispatch as ramble:* on window
// for Web Components that can't import eventBus
declare global {
  interface WindowEventMap {
    'ramble:tts:speak': CustomEvent<{ text: string; voice?: string; mode?: 'replace' | 'queue' }>;
    'ramble:tts:stop': CustomEvent<Record<string, never>>;
  }
}
