/**
 * Voice Agent Hook
 *
 * React hook that connects to the GeminiLive singleton manager
 * and provides state updates via callbacks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { geminiLive, type GeminiLiveCallbacks } from '../services/geminiLive';
import { getObserverAgentAI, type TaskStatus, type ObserverMessage } from '../services/observerAgentAI';
import { useAudioRecorder } from './useAudioRecorder';
import { useAudioPlayer } from './useAudioPlayer';
import { settingsHelpers } from '../stores/settingsStore';
import { conversationHelpers, type ConversationMessage } from '../stores/conversationStore';

export interface UseVoiceAgentReturn {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  isRecording: boolean;
  isListening: boolean;
  isPlaying: boolean;
  observerStatus: TaskStatus;
  observerMessages: ObserverMessage[];
  currentUserTranscript: string;
  currentModelTranscript: string;
  recentMessages: ConversationMessage[];
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleRecording: () => Promise<void>;
  sendText: (text: string) => void;
}

export function useVoiceAgent(): UseVoiceAgentReturn {
  // State
  const [isConnected, setIsConnected] = useState(geminiLive.isConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [currentUserTranscript, setCurrentUserTranscript] = useState('');
  const [currentModelTranscript, setCurrentModelTranscript] = useState('');
  const [observerStatus, setObserverStatus] = useState<TaskStatus>({ status: 'idle', description: 'Ready' });
  const [observerMessages, setObserverMessages] = useState<ObserverMessage[]>([]);
  const [recentMessages, setRecentMessages] = useState<ConversationMessage[]>([]);

  // Audio recorder
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  // Audio player
  const { isPlaying, playAudio, stop: stopPlayback, clearBuffer } = useAudioPlayer({
    sampleRate: 24000,
  });

  // Refs for callbacks
  const playAudioRef = useRef(playAudio);
  const stopPlaybackRef = useRef(stopPlayback);
  const clearBufferRef = useRef(clearBuffer);

  useEffect(() => {
    playAudioRef.current = playAudio;
    stopPlaybackRef.current = stopPlayback;
    clearBufferRef.current = clearBuffer;
  });

  // Set up Gemini callbacks on mount
  useEffect(() => {
    const callbacks: GeminiLiveCallbacks = {
      onConnected: () => {
        console.log('[VoiceAgent] Connected to Gemini');
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
      },
      onDisconnected: () => {
        console.log('[VoiceAgent] Disconnected');
        setIsConnected(false);
        setIsConnecting(false);
      },
      onError: (error) => {
        console.error('[VoiceAgent] Error:', error);
        setConnectionError(error.message);
        setIsConnecting(false);
      },
      onAudioData: (audioData) => {
        playAudioRef.current(audioData);
      },
      onUserTranscript: (text, isFinal) => {
        setCurrentUserTranscript(text);
        setIsListening(!isFinal);
      },
      onModelTranscript: (text, isFinal) => {
        setCurrentModelTranscript(text);
        if (isFinal) {
          setRecentMessages(conversationHelpers.getRecentMessages(20));
          setCurrentModelTranscript('');
        }
      },
      onTurnComplete: () => {
        setCurrentUserTranscript('');
        setCurrentModelTranscript('');
        setIsListening(false);
        setRecentMessages(conversationHelpers.getRecentMessages(20));
      },
      onInterrupted: () => {
        console.log('[VoiceAgent] Interrupted');
        stopPlaybackRef.current();
        clearBufferRef.current();
      },
    };

    geminiLive.setCallbacks(callbacks);

    // Initialize observer (AI SDK version)
    const observerAgent = getObserverAgentAI();
    observerAgent.setStatusCallback(setObserverStatus);

    // Subscribe to observer messages
    const unsubscribeObserver = observerAgent.subscribeToMessages(setObserverMessages);

    // Load recent messages
    setRecentMessages(conversationHelpers.getRecentMessages(20));

    // Auto-connect if API key available
    const apiKey = settingsHelpers.getApiKey('gemini');
    if (apiKey && !geminiLive.isConnected()) {
      setIsConnecting(true);
      geminiLive.connect().catch((err) => {
        setConnectionError(err.message);
        setIsConnecting(false);
      });
    }

    return () => {
      unsubscribeObserver();
    };
  }, []);

  // Connect
  const connect = useCallback(async () => {
    if (geminiLive.isConnected() || isConnecting) return;

    const apiKey = settingsHelpers.getApiKey('gemini');
    if (!apiKey) {
      setConnectionError('Gemini API key not configured. Please add it in Settings.');
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      await geminiLive.connect();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Failed to connect');
      setIsConnecting(false);
    }
  }, [isConnecting]);

  // Disconnect
  const disconnect = useCallback(() => {
    geminiLive.disconnect();
    stopRecording();
    stopPlayback();
    setIsConnected(false);
    setIsConnecting(false);
  }, [stopRecording, stopPlayback]);

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      // Connect first if needed
      if (!geminiLive.isConnected()) {
        await connect();
      }
      // Start recording and send audio to Gemini
      await startRecording((base64Audio) => {
        geminiLive.sendAudio(base64Audio);
      });
    }
  }, [isRecording, connect, startRecording, stopRecording]);

  // Send text
  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!geminiLive.isConnected()) {
      conversationHelpers.addUserMessage(trimmed);
      setRecentMessages(conversationHelpers.getRecentMessages(20));
      connect().then(() => {
        geminiLive.sendText(trimmed);
      });
    } else {
      geminiLive.sendText(trimmed);
      setRecentMessages(conversationHelpers.getRecentMessages(20));
    }
  }, [connect]);

  return {
    isConnected,
    isConnecting,
    connectionError,
    isRecording,
    isListening,
    isPlaying,
    observerStatus,
    observerMessages,
    currentUserTranscript,
    currentModelTranscript,
    recentMessages,
    connect,
    disconnect,
    toggleRecording,
    sendText,
  };
}
