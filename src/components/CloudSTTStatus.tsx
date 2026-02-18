/**
 * CloudSTTStatus - Visual indicator for browser-based STT state
 *
 * Shows recording/transcribing state when using cloud STT (not RambleNative).
 * Uses violet/blue/teal color palette to distinguish from RambleNative's red/amber/green.
 * Shows actual VAD-detected speech duration (not wall-clock time) and API call duration.
 *
 * Designed to fit inside the header (h-9 = 36px).
 */

import { useState, useEffect, useRef } from 'react';
import { useGlobalSTT } from './GlobalSTTController';
import { rambleNative } from '../services/stt/rambleNative';
import { eventBus } from '../lib/eventBus';

export function CloudSTTStatus() {
  const { isRecording, isProcessing } = useGlobalSTT();
  const [isNativeConnected, setIsNativeConnected] = useState(rambleNative.isRambleAvailable());
  const [speechDuration, setSpeechDuration] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [apiDuration, setApiDuration] = useState<number | null>(null);
  const transcribeStartRef = useRef<number | null>(null);

  // Track RambleNative connection
  useEffect(() => {
    const check = () => setIsNativeConnected(rambleNative.isRambleAvailable());
    const interval = setInterval(check, 2000);
    check();
    return () => clearInterval(interval);
  }, []);

  // Listen for VAD activity events
  useEffect(() => {
    return eventBus.on('stt:vad-activity', ({ speechDuration: dur, speaking: spk }) => {
      setSpeechDuration(dur);
      setSpeaking(spk);
    });
  }, []);

  // Reset when recording starts
  useEffect(() => {
    if (isRecording) {
      setSpeechDuration(0);
      setSpeaking(false);
      setApiDuration(null);
    }
  }, [isRecording]);

  // Track transcription (API call) duration
  useEffect(() => {
    if (isProcessing) {
      transcribeStartRef.current = Date.now();
    } else if (transcribeStartRef.current) {
      const duration = Date.now() - transcribeStartRef.current;
      transcribeStartRef.current = null;
      setApiDuration(duration);
      // Clear after 3 seconds
      const timeout = setTimeout(() => setApiDuration(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [isProcessing]);

  // Don't show when RambleNative is connected (it has its own indicator)
  if (isNativeConnected) return null;

  // Nothing to show
  if (!isRecording && !isProcessing && apiDuration === null) return null;

  if (isRecording) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-violet-600 font-medium"
        title="Cloud STT recording — shows VAD-detected speech duration"
      >
        <span className={`w-1.5 h-1.5 rounded-full bg-violet-500 ${speaking ? 'animate-pulse' : ''}`} />
        <span>Listening</span>
        {speechDuration > 0 && (
          <span className="text-violet-400 tabular-nums">{speechDuration.toFixed(1)}s</span>
        )}
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-blue-600 font-medium"
        title="Transcribing audio via API"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        <span>Transcribing</span>
      </div>
    );
  }

  // Show API duration briefly after completion
  if (apiDuration !== null) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-teal-600 font-medium"
        title="Transcription complete"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
        <span>Done</span>
        <span className="text-teal-400">{(apiDuration / 1000).toFixed(1)}s</span>
      </div>
    );
  }

  return null;
}
