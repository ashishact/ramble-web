/**
 * Audio Player Hook - plays PCM audio from Gemini
 */

import { useRef, useCallback, useState } from 'react';

interface UseAudioPlayerOptions {
  sampleRate?: number;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

interface UseAudioPlayerReturn {
  isPlaying: boolean;
  playAudio: (pcmData: ArrayBuffer) => void;
  stop: () => void;
  clearBuffer: () => void;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const { sampleRate = 24000, onPlaybackStart, onPlaybackEnd } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate });
    }
    return audioContextRef.current;
  }, [sampleRate]);

  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      onPlaybackEnd?.();
      return;
    }

    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    isPlayingRef.current = true;
    setIsPlaying(true);

    const buffer = audioQueueRef.current.shift()!;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    currentSourceRef.current = source;

    source.onended = () => {
      currentSourceRef.current = null;
      playNextInQueue();
    };

    source.start();
  }, [onPlaybackEnd]);

  const playAudio = useCallback((pcmData: ArrayBuffer) => {
    try {
      const audioContext = initAudioContext();

      // Resume if suspended (needed after user interaction)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      // Convert PCM16 to Float32
      // Ensure even length for Int16Array
      const evenLength = pcmData.byteLength - (pcmData.byteLength % 2);
      const int16Array = new Int16Array(pcmData, 0, evenLength / 2);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      // Add to queue
      audioQueueRef.current.push(audioBuffer);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        onPlaybackStart?.();
        playNextInQueue();
      }
    } catch (error) {
      console.error('[AudioPlayer] Error:', error);
    }
  }, [initAudioContext, sampleRate, playNextInQueue, onPlaybackStart]);

  const stop = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Ignore
      }
      currentSourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsPlaying(false);
    onPlaybackEnd?.();
  }, [onPlaybackEnd]);

  const clearBuffer = useCallback(() => {
    audioQueueRef.current = [];
  }, []);

  return {
    isPlaying,
    playAudio,
    stop,
    clearBuffer,
  };
}
