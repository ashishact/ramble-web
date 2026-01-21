/**
 * VoiceRecorder Component
 *
 * Handles voice recording with:
 * - Button click to toggle recording
 * - Keyboard shortcut (Right Command key on Mac)
 * - Live transcript display
 * - Callback when recording completes with final transcript
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSTT } from '../../services/stt/useSTT';
import { settingsHelpers } from '../../stores/settingsStore';
import { rambleChecker } from '../../services/stt/rambleChecker';
import { useRamblePaste } from '../../hooks/useRamblePaste';
import { showTranscriptReview } from '../TranscriptReview';

export interface VoiceRecorderProps {
  /** Called when recording completes with the final transcript */
  onTranscript: (text: string) => Promise<void>;
  /** Called when API key is missing */
  onMissingApiKey?: () => void;
  /** Whether the parent is processing (disables recording) */
  disabled?: boolean;
}

export function VoiceRecorder({
  onTranscript,
  onMissingApiKey,
  disabled = false,
}: VoiceRecorderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');

  // STT configuration
  const sttConfig = useMemo(
    () => ({
      tier: 'small' as const,
      apiKey: settingsHelpers.getApiKey('groq') || '',
      chunkingStrategy: 'vad' as const,
    }),
    []
  );

  // STT hook
  const {
    isConnected: sttConnected,
    isRecording,
    transcript,
    connect: connectSTT,
    disconnect: disconnectSTT,
    startRecording,
    stopRecordingAndWait,
    clearTranscript,
  } = useSTT({ config: sttConfig });

  // Handle paste from Ramble (registers once, never re-registers)
  useRamblePaste((text) => {
    console.log('[VoiceRecorder] Received transcript from Ramble paste');
    onTranscript(text);
  });

  // Update transcript display
  useEffect(() => {
    setCurrentTranscript(transcript);
  }, [transcript]);

  // Connect STT on mount
  useEffect(() => {
    let mounted = true;
    const initSTT = async () => {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      if (groqApiKey && mounted) {
        try {
          await connectSTT();
        } catch (err) {
          console.error('[VoiceRecorder] STT connection error:', err);
        }
      }
    };
    initSTT();
    return () => {
      mounted = false;
      disconnectSTT();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle recording toggle
  const handleToggleRecording = useCallback(async () => {
    console.log('[VoiceRecorder] Toggle recording - disabled:', disabled, 'isProcessing:', isProcessing, 'isRecording:', isRecording);
    if (disabled || isProcessing) return;

    if (isRecording) {
      setIsProcessing(true);
      try {
        console.log('[VoiceRecorder] Stopping recording, waiting for transcript...');
        // Wait for final transcript
        const finalTranscript = await stopRecordingAndWait(10000);
        console.log('[VoiceRecorder] Got final transcript:', finalTranscript);

        if (finalTranscript.trim()) {
          // Show transcript review instead of direct submit
          showTranscriptReview(finalTranscript.trim(), (reviewedText) => {
            onTranscript(reviewedText);
          });
        } else {
          console.warn('[VoiceRecorder] Empty transcript received');
        }
      } catch (err) {
        console.error('[VoiceRecorder] Failed to process:', err);
      } finally {
        setIsProcessing(false);
        clearTranscript();
        setCurrentTranscript('');
      }
    } else {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      console.log('[VoiceRecorder] Starting recording, API key present:', !!groqApiKey, 'STT connected:', sttConnected);
      if (!groqApiKey) {
        onMissingApiKey?.();
        return;
      }
      if (!sttConnected) {
        console.log('[VoiceRecorder] Connecting STT...');
        await connectSTT();
      }
      console.log('[VoiceRecorder] Starting recording...');
      await startRecording();
    }
  }, [
    disabled,
    isProcessing,
    isRecording,
    sttConnected,
    connectSTT,
    startRecording,
    stopRecordingAndWait,
    clearTranscript,
    onTranscript,
    onMissingApiKey,
  ]);

  // Keyboard shortcut: Right Command key toggles recording
  // Only handles cloud STT when Ramble is not available
  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      // Right Command key on Mac
      if (event.code === 'MetaRight') {
        // If Ramble is available, let it handle the keyboard
        if (rambleChecker.isRambleAvailable()) {
          console.log('[VoiceRecorder] Right Command - Ramble available, letting it handle');
          return;
        }

        event.preventDefault();
        console.log('[VoiceRecorder] Right Command - toggling cloud STT recording');
        handleToggleRecording();
      }
    };

    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [handleToggleRecording]);

  return (
    <div className="flex flex-col gap-2">
      {/* Recording Button */}
      <button
        className={`btn btn-sm ${isRecording ? 'btn-error animate-pulse' : 'btn-primary'} gap-1`}
        onClick={handleToggleRecording}
        disabled={disabled || isProcessing}
        title="Toggle recording (Right ⌘)"
      >
        {isRecording ? (
          <>
            <span className="w-2 h-2 rounded-full bg-white"></span>
            Stop
          </>
        ) : isProcessing ? (
          <span className="loading loading-spinner loading-xs"></span>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            Record
          </>
        )}
      </button>

      {/* Live Transcript */}
      {(currentTranscript || isRecording) && (
        <div className="bg-base-200 p-2 rounded text-sm flex items-center gap-2">
          {isRecording && <span className="loading loading-dots loading-xs text-error"></span>}
          <span className="opacity-70 italic">{currentTranscript || 'Listening...'}</span>
        </div>
      )}
    </div>
  );
}
