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

// Window event type augmentation
declare global {
  interface WindowEventMap {
    'tts:speak': CustomEvent<TTSSpeakEvent>;
    'tts:stop': CustomEvent<void>;
  }
}
