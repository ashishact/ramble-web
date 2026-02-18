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
 * EVENT BUS USAGE:
 * ================
 * This component emits events via eventBus for cross-component communication:
 * - tts:stop - Stop TTS when user starts recording (user input takes priority)
 * - stt:recording-started - Recording has begun
 * - stt:recording-stopped - Recording has stopped
 * - stt:transcribing - Transcription in progress
 * - stt:final - Final transcription received
 *
 * See eventBus.ts for the full event pattern documentation.
 *
 * LENS WIDGET INTEGRATION:
 * ========================
 * Before submitting input to the kernel, we check if a Lens Widget is active.
 * If so, the input is routed to the lens widget instead of the core pipeline.
 * This enables "meta queries" that don't pollute conversation history.
 *
 * The routing decision happens in handleSubmitTranscript() and the paste handler.
 * See lensController.ts for the full lens architecture.
 *
 * Mount this at the app level (above the bento grid) to ensure STT is always available.
 */

import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { useSTT } from '../services/stt/useSTT';
import { settingsHelpers, type AppSettings } from '../stores/settingsStore';
import { rambleNative } from '../services/stt/rambleNative';
import { useKernel } from '../program/hooks';
import { resolveSTTTier } from '../program';
import type { STTProvider } from '../services/stt/types';

/** Map STT provider to settings provider key for API key lookup */
const STT_PROVIDER_TO_SETTINGS_KEY: Record<STTProvider, keyof AppSettings['providers']> = {
  'groq-whisper': 'groq',
  'gemini': 'gemini',
  'deepgram-nova': 'deepgram',
  'deepgram-flux': 'deepgram',
  'mistral': 'mistral',
};

/** Get the API key for the resolved STT tier provider */
function getSTTApiKey(tier: 'small' | 'medium' | 'large' | 'live'): string {
  const resolved = resolveSTTTier(tier);
  const settingsKey = STT_PROVIDER_TO_SETTINGS_KEY[resolved.provider];
  return settingsHelpers.getApiKey(settingsKey) || '';
}
import { TranscriptReview, type RambleMetadata } from './TranscriptReview';
import { lensController } from '../lib/lensController';
import { eventBus } from '../lib/eventBus';

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
  const [reviewSource, setReviewSource] = useState<'speech' | 'paste' | 'keyboard'>('speech');
  const [reviewTargetLens, setReviewTargetLens] = useState<{
    id: string;
    type: string;
    name: string;
  } | null>(null);
  const reviewCallbackRef = useRef<((text: string, source: 'speech' | 'paste' | 'keyboard') => void) | null>(null);

  // Get kernel for submitting input
  const { submitInput, isInitialized } = useKernel();

  // STT configuration - dynamically resolve API key based on tier's provider
  const sttConfig = useMemo(
    () => ({
      tier: 'small' as const,
      apiKey: getSTTApiKey('small'),
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
      const sttApiKey = getSTTApiKey('small');
      if (sttApiKey && mounted) {
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
  // LENS ROUTING: Route to captured lens ID, or check current active lens
  const handleSubmitTranscript = useCallback(
    async (
      text: string,
      source: 'speech' | 'paste' | 'keyboard' = 'speech',
      targetLensId: string | null = null
    ) => {
      if (!text.trim()) return;

      // First, try to route to the captured lens ID (from when review opened)
      // This handles the case where user moved mouse away to click Submit
      if (lensController.routeInputToLens(targetLensId, text.trim(), source)) {
        console.log('[GlobalSTT] Input routed to captured lens:', targetLensId);
        return;
      }

      // Fallback: check if a lens is currently active (direct submit without review)
      if (lensController.routeInput(text.trim(), source)) {
        console.log('[GlobalSTT] Input routed to active lens widget, skipping kernel');
        return;
      }

      // Normal flow: submit to kernel
      if (!isInitialized) return;

      try {
        await submitInput(text.trim());
      } catch (err) {
        console.error('[GlobalSTT] Processing failed:', err);
      }
    },
    [submitInput, isInitialized]
  );

  // Show transcript review
  // Captures the active lens at this moment (before user moves mouse to click Submit)
  const showReview = useCallback((
    text: string,
    onSubmit: (reviewed: string, source: 'speech' | 'paste' | 'keyboard') => void,
    source: 'speech' | 'paste' | 'keyboard' = 'speech',
    metadata?: RambleMetadata | null
  ) => {
    setReviewText(text);
    setReviewMetadata(metadata || null);
    setReviewSource(source);
    setReviewTargetLens(lensController.getActiveLens());
    reviewCallbackRef.current = onSubmit;
  }, []);

  // Handle review submit
  // Uses the captured lens ID from when review opened, not the current active lens
  const handleReviewSubmit = useCallback(
    (text: string) => {
      // Call handleSubmitTranscript with the captured lens ID
      handleSubmitTranscript(text, reviewSource, reviewTargetLens?.id ?? null);
      setReviewText(null);
      setReviewMetadata(null);
      setReviewSource('speech');
      setReviewTargetLens(null);
      reviewCallbackRef.current = null;
    },
    [reviewSource, reviewTargetLens, handleSubmitTranscript]
  );

  // Handle review cancel
  const handleReviewCancel = useCallback(() => {
    setReviewText(null);
    setReviewMetadata(null);
    setReviewSource('speech');
    setReviewTargetLens(null);
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
      eventBus.emit('stt:recording-stopped', {});
      try {
        console.log('[GlobalSTT] Stopping recording, waiting for transcript...');
        eventBus.emit('stt:transcribing', {});
        const finalTranscript = await stopRecordingAndWait(10000);
        console.log('[GlobalSTT] Got final transcript:', finalTranscript);
        eventBus.emit('stt:final', { text: finalTranscript });

        if (finalTranscript.trim()) {
          showReview(finalTranscript.trim(), handleSubmitTranscript, 'speech');
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
      const sttApiKey = getSTTApiKey('small');
      console.log(
        '[GlobalSTT] Starting recording, API key present:',
        !!sttApiKey,
        'STT connected:',
        sttConnected
      );
      if (!sttApiKey) {
        console.warn('[GlobalSTT] No API key configured for STT provider');
        return;
      }
      if (!sttConnected) {
        console.log('[GlobalSTT] Connecting STT...');
        await connectSTT();
      }
      console.log('[GlobalSTT] Starting recording...');
      // Stop TTS when user starts recording - user input takes priority
      eventBus.emit('tts:stop', {});
      eventBus.emit('stt:recording-started', {});
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

  // Track keydown time for quick-tap detection (forward slash shortcut)
  const slashKeyDownTimeRef = useRef<number | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Forward slash - record keydown time for quick-tap detection
      if (event.key === '/') {
        slashKeyDownTimeRef.current = Date.now();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Right Command key (Mac) or Right Control key (Windows/Linux) - toggles recording
      if (event.code === 'MetaRight' || event.code === 'ControlRight') {
        // If Ramble is available, let it handle the keyboard
        if (rambleNative.isRambleAvailable()) {
          console.log('[GlobalSTT] Right modifier key - Ramble available, letting it handle');
          return;
        }

        event.preventDefault();
        console.log('[GlobalSTT] Right modifier key - toggling cloud STT recording');
        handleToggleRecording();
        return;
      }

      // Forward slash - quick tap opens text editor directly
      if (event.key === '/') {
        // Don't trigger if in an input field or textarea
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          (activeElement as HTMLElement)?.isContentEditable
        ) {
          slashKeyDownTimeRef.current = null;
          return;
        }

        // Check if it was a quick tap (≤300ms)
        const keyDownTime = slashKeyDownTimeRef.current;
        slashKeyDownTimeRef.current = null;

        if (keyDownTime === null) return;

        const pressDuration = Date.now() - keyDownTime;
        if (pressDuration > 300) {
          console.log('[GlobalSTT] Slash key held too long, ignoring:', pressDuration, 'ms');
          return;
        }

        event.preventDefault();
        console.log('[GlobalSTT] Quick slash tap - opening text editor');
        showReview('', handleSubmitTranscript, 'keyboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleToggleRecording, showReview, handleSubmitTranscript]);

  // Handle Ramble paste events
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Only handle paste when ramble is available
      if (!rambleNative.isRambleAvailable()) return;

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

      showReview(text.trim(), handleSubmitTranscript, 'paste', rambleMetadata);
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
          targetLensName={reviewTargetLens?.name}
        />
      )}
    </GlobalSTTContext.Provider>
  );
}
