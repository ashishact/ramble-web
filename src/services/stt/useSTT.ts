/**
 * useSTT Hook
 *
 * React hook for easy integration of STT service (Singleton)
 *
 * The actual WebSocket and audio connections live outside React
 * in a singleton service, so re-renders won't cause reconnections
 */

import { useState, useEffect, useCallback } from 'react';
import { getSTTService } from './STTService';
import type {
  STTConfig,
  STTTranscript,
  STTError,
  STTConnectionStatus,
} from './types';

// Get singleton instance outside the component
const sttService = getSTTService();

export interface UseSTTOptions {
  config: STTConfig;
  autoConnect?: boolean;
}

export interface UseSTTReturn {
  // State
  transcript: string;
  isConnected: boolean;
  isRecording: boolean;
  error: STTError | null;
  status: STTConnectionStatus | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  sendAudio: (audioData: ArrayBuffer | Blob) => void;
  clearTranscript: () => void;
}

export function useSTT(options: UseSTTOptions): UseSTTReturn {
  const [transcript, setTranscript] = useState('');
  const [isConnected, setIsConnected] = useState(sttService.isConnected());
  const [isRecording, setIsRecording] = useState(sttService.isRecording());
  const [error, setError] = useState<STTError | null>(null);
  const [status, setStatus] = useState<STTConnectionStatus | null>(null);

  const connect = useCallback(async () => {
    try {
      setError(null);
      await sttService.connect(options.config, {
        onTranscript: (t: STTTranscript) => {
          setTranscript(t.text);
        },
        onError: (e: STTError) => {
          setError(e);
        },
        onStatusChange: (s: STTConnectionStatus) => {
          setStatus(s);
          setIsConnected(s.connected);
          setIsRecording(s.recording);
        },
      });
      setIsConnected(true);
    } catch (err) {
      setError({
        code: 'CONNECTION_FAILED',
        message: err instanceof Error ? err.message : 'Failed to connect',
        provider: options.config.provider || 'groq-whisper',
      });
    }
  }, [options.config]);

  const disconnect = useCallback(() => {
    sttService.disconnect();
    setIsConnected(false);
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Ensure provider exists with latest config before starting recording
      await sttService.ensureProvider(options.config, {
        onTranscript: (t: STTTranscript) => {
          setTranscript(t.text);
        },
        onError: (e: STTError) => {
          setError(e);
        },
        onStatusChange: (s: STTConnectionStatus) => {
          setStatus(s);
          setIsConnected(s.connected);
          setIsRecording(s.recording);
        },
      });

      await sttService.startRecording();
      setIsRecording(true);
    } catch (err) {
      setError({
        code: 'RECORDING_FAILED',
        message: err instanceof Error ? err.message : 'Failed to start recording',
        provider: options.config.provider || 'groq-whisper',
      });
    }
  }, [options.config]);

  const stopRecording = useCallback(() => {
    sttService.stopRecording();
    setIsRecording(false);
  }, []);

  const sendAudio = useCallback((audioData: ArrayBuffer | Blob) => {
    try {
      sttService.sendAudio(audioData);
    } catch (err) {
      setError({
        code: 'SEND_AUDIO_FAILED',
        message: err instanceof Error ? err.message : 'Failed to send audio',
        provider: options.config.provider || 'groq-whisper',
      });
    }
  }, [options.config.provider]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  // Auto-connect on mount if enabled, and reconnect when config changes
  useEffect(() => {
    if (options.autoConnect) {
      // Always call connect - the singleton will decide if it needs to reconnect
      connect();
    }

    // Don't disconnect on unmount - singleton persists
    // Only cleanup happens when user explicitly disconnects
  }, [options.autoConnect, connect]);

  return {
    transcript,
    isConnected,
    isRecording,
    error,
    status,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendAudio,
    clearTranscript,
  };
}
