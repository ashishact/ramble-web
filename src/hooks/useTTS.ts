/**
 * React hook for TTS functionality with chunk-based playback
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  TTSPlaybackState,
  TTSProgressInfo,
  TTSConfig,
  TTSPart,
} from '../services/tts/types';
import { ttsService } from '../services/tts/TTSService';

export interface UseTTSReturn {
  playbackState: TTSPlaybackState;
  progress: TTSProgressInfo | null;
  highlightedWordIndex: number;
  highlightedWord: string;
  queueLength: number;
  currentWords: string[];
  currentVoice: string;
  // Chunk-based state
  parts: TTSPart[];
  currentPartId: string;
  // Actions
  speak: (text: string, config?: TTSConfig) => Promise<void>;
  queueText: (text: string, voice?: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setVoice: (voice: string) => void;
  playNext: () => void;
  playPrev: () => void;
  // Audio element for external use (gradient updates)
  getPlayingAudioElement: () => HTMLAudioElement | null;
}

export function useTTS(): UseTTSReturn {
  const [playbackState, setPlaybackState] = useState<TTSPlaybackState>('idle');
  const [progress, setProgress] = useState<TTSProgressInfo | null>(null);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(0);
  const [highlightedWord, setHighlightedWord] = useState('');
  const [queueLength, setQueueLength] = useState(0);
  const [currentVoice, setCurrentVoice] = useState(ttsService.getVoice());
  const [currentWords, setCurrentWords] = useState<string[]>([]);
  const [parts, setParts] = useState<TTSPart[]>([]);
  const [currentPartId, setCurrentPartId] = useState('');

  // Use ref to track if callbacks are set
  const callbacksSet = useRef(false);

  useEffect(() => {
    if (callbacksSet.current) return;
    callbacksSet.current = true;

    ttsService.setCallbacks({
      onStateChange: (state) => {
        setPlaybackState(state);
        // Update words when playback starts
        if (state === 'playing') {
          setCurrentWords(ttsService.getCurrentWords());
        }
        if (state === 'idle') {
          setProgress(null);
          setHighlightedWordIndex(0);
          setHighlightedWord('');
          setCurrentWords([]);
        }
      },
      onProgress: (prog) => setProgress(prog),
      onWordHighlight: (index, word) => {
        setHighlightedWordIndex(index);
        setHighlightedWord(word);
      },
      onPartChange: (partId, newParts) => {
        setCurrentPartId(partId);
        setParts([...newParts]);
      },
      onQueueChange: (length) => setQueueLength(length),
      onError: (error) => console.error('TTS Error:', error),
    });

    return () => {
      // Don't clear callbacks on unmount - service is singleton
    };
  }, []);

  const speak = useCallback(async (text: string, config?: TTSConfig) => {
    await ttsService.speak(text, config);
  }, []);

  const queueText = useCallback((text: string, voice?: string) => {
    ttsService.queueText(text, voice);
  }, []);

  const stop = useCallback(() => {
    ttsService.stop();
  }, []);

  const pause = useCallback(() => {
    ttsService.pause();
  }, []);

  const resume = useCallback(() => {
    ttsService.resume();
  }, []);

  const setVoice = useCallback((voice: string) => {
    ttsService.setVoice(voice);
    setCurrentVoice(voice);
  }, []);

  const playNext = useCallback(() => {
    ttsService.playNext();
  }, []);

  const playPrev = useCallback(() => {
    ttsService.playPrev();
  }, []);

  const getPlayingAudioElement = useCallback(() => {
    return ttsService.getPlayingAudioElement();
  }, []);

  return {
    playbackState,
    progress,
    highlightedWordIndex,
    highlightedWord,
    queueLength,
    currentWords,
    currentVoice,
    parts,
    currentPartId,
    speak,
    queueText,
    stop,
    pause,
    resume,
    setVoice,
    playNext,
    playPrev,
    getPlayingAudioElement,
  };
}
