/**
 * GlobalSTTController - Global speech-to-text controller
 *
 * This component handles all STT functionality globally, independent of the bento grid.
 * It manages:
 * - Keyboard shortcuts (Right Command key)
 * - Ramble paste integration
 * - Recording state
 * - TranscriptReview overlay
 * - Kernel submission
 *
 * Mount this at the app level (above the bento grid) to ensure STT is always available.
 */

import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { useSTT } from '../services/stt/useSTT';
import { settingsHelpers } from '../stores/settingsStore';
import { rambleChecker } from '../services/stt/rambleChecker';
import { useKernel } from '../program/hooks';
import { TranscriptReview, type RambleMetadata } from './TranscriptReview';

/**
 * Parse Ramble metadata from HTML clipboard content (compact format)
 *
 * HTML format:
 *   <span data-ramble='{"s":"ramble","v":"1.9","ts":1706367000000,"t":"t","d":5.2}'>text</span>
 *
 * Keys: s=source, v=version, ts=timestamp(unix ms), t=type(t/x), d=duration
 */
function parseRambleMetadata(html: string): RambleMetadata | null {
  try {
    const match = html.match(/data-ramble='([^']+)'/);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    if (!data.s) return null;  // Must have source

    return {
      source: data.s,
      version: data.v,
      timestamp: data.ts,
      type: data.t === 'x' ? 'transformation' : 'transcription',
      duration: data.d,
    };
  } catch {
    return null;
  }
}

// Global STT state context
interface GlobalSTTState {
  isRecording: boolean;
  isProcessing: boolean;
  transcript: string;
  isConnected: boolean;
  toggleRecording: () => Promise<void>;
}

const GlobalSTTContext = createContext<GlobalSTTState | null>(null);

export function useGlobalSTT(): GlobalSTTState {
  const context = useContext(GlobalSTTContext);
  if (!context) {
    throw new Error('useGlobalSTT must be used within GlobalSTTController');
  }
  return context;
}

interface GlobalSTTControllerProps {
  children: React.ReactNode;
}

export function GlobalSTTController({ children }: GlobalSTTControllerProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');

  // Transcript review state
  const [reviewText, setReviewText] = useState<string | null>(null);
  const [reviewMetadata, setReviewMetadata] = useState<RambleMetadata | null>(null);
  const reviewCallbackRef = useRef<((text: string) => void) | null>(null);

  // Get kernel for submitting input
  const { submitInput, isInitialized } = useKernel();

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
          console.error('[GlobalSTT] STT connection error:', err);
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

  // Handle transcript submission (after review)
  const handleSubmitTranscript = useCallback(
    async (text: string) => {
      if (!text.trim() || !isInitialized) return;

      try {
        await submitInput(text.trim());
      } catch (err) {
        console.error('[GlobalSTT] Processing failed:', err);
      }
    },
    [submitInput, isInitialized]
  );

  // Show transcript review
  const showReview = useCallback((text: string, onSubmit: (reviewed: string) => void, metadata?: RambleMetadata | null) => {
    setReviewText(text);
    setReviewMetadata(metadata || null);
    reviewCallbackRef.current = onSubmit;
  }, []);

  // Handle review submit
  const handleReviewSubmit = useCallback(
    (text: string) => {
      if (reviewCallbackRef.current) {
        reviewCallbackRef.current(text);
      }
      setReviewText(null);
      setReviewMetadata(null);
      reviewCallbackRef.current = null;
    },
    []
  );

  // Handle review cancel
  const handleReviewCancel = useCallback(() => {
    setReviewText(null);
    setReviewMetadata(null);
    reviewCallbackRef.current = null;
  }, []);

  // Handle recording toggle
  const handleToggleRecording = useCallback(async () => {
    console.log(
      '[GlobalSTT] Toggle recording - isProcessing:',
      isProcessing,
      'isRecording:',
      isRecording
    );
    if (isProcessing) return;

    if (isRecording) {
      setIsProcessing(true);
      try {
        console.log('[GlobalSTT] Stopping recording, waiting for transcript...');
        const finalTranscript = await stopRecordingAndWait(10000);
        console.log('[GlobalSTT] Got final transcript:', finalTranscript);

        if (finalTranscript.trim()) {
          showReview(finalTranscript.trim(), handleSubmitTranscript);
        } else {
          console.warn('[GlobalSTT] Empty transcript received');
        }
      } catch (err) {
        console.error('[GlobalSTT] Failed to process:', err);
      } finally {
        setIsProcessing(false);
        clearTranscript();
        setCurrentTranscript('');
      }
    } else {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      console.log(
        '[GlobalSTT] Starting recording, API key present:',
        !!groqApiKey,
        'STT connected:',
        sttConnected
      );
      if (!groqApiKey) {
        console.warn('[GlobalSTT] No API key configured');
        return;
      }
      if (!sttConnected) {
        console.log('[GlobalSTT] Connecting STT...');
        await connectSTT();
      }
      console.log('[GlobalSTT] Starting recording...');
      await startRecording();
    }
  }, [
    isProcessing,
    isRecording,
    sttConnected,
    connectSTT,
    startRecording,
    stopRecordingAndWait,
    clearTranscript,
    showReview,
    handleSubmitTranscript,
  ]);

  // Keyboard shortcut: Right Command key toggles recording
  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      // Right Command key on Mac
      if (event.code === 'MetaRight') {
        // If Ramble is available, let it handle the keyboard
        if (rambleChecker.isRambleAvailable()) {
          console.log('[GlobalSTT] Right Command - Ramble available, letting it handle');
          return;
        }

        event.preventDefault();
        console.log('[GlobalSTT] Right Command - toggling cloud STT recording');
        handleToggleRecording();
      }
    };

    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [handleToggleRecording]);

  // Handle Ramble paste events
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Only handle paste when ramble is available
      if (!rambleChecker.isRambleAvailable()) return;

      // Don't intercept if an input element is focused
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const text = event.clipboardData?.getData('text');
      if (!text) return;

      event.preventDefault();

      // Check for HTML content with Ramble metadata
      const html = event.clipboardData?.getData('text/html') || '';
      const rambleMetadata = parseRambleMetadata(html);

      if (rambleMetadata) {
        console.log('[GlobalSTT] Captured Ramble paste with metadata:', rambleMetadata);
      } else {
        console.log('[GlobalSTT] Captured Ramble paste (no metadata)');
      }

      showReview(text.trim(), handleSubmitTranscript, rambleMetadata);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [showReview, handleSubmitTranscript]);

  // Context value
  const contextValue = useMemo<GlobalSTTState>(
    () => ({
      isRecording,
      isProcessing,
      transcript: currentTranscript,
      isConnected: sttConnected,
      toggleRecording: handleToggleRecording,
    }),
    [isRecording, isProcessing, currentTranscript, sttConnected, handleToggleRecording]
  );

  return (
    <GlobalSTTContext.Provider value={contextValue}>
      {children}

      {/* Transcript Review Overlay */}
      {reviewText !== null && (
        <TranscriptReview
          initialText={reviewText}
          onSubmit={handleReviewSubmit}
          onCancel={handleReviewCancel}
          rambleMetadata={reviewMetadata}
        />
      )}
    </GlobalSTTContext.Provider>
  );
}
