/**
 * CloudSTTStatus - Visual indicator for browser-based STT state
 *
 * Dot-only. Hover triggers HelpStrip doc at the bottom of the screen.
 * Shows when RambleNative is not connected — they are mutually exclusive.
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

  useEffect(() => {
    const check = () => setIsNativeConnected(rambleNative.isRambleAvailable());
    const interval = setInterval(check, 2000);
    check();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return eventBus.on('stt:vad-activity', ({ speechDuration: dur, speaking: spk }) => {
      setSpeechDuration(dur);
      setSpeaking(spk);
    });
  }, []);

  useEffect(() => {
    if (isRecording) {
      setSpeechDuration(0);
      setSpeaking(false);
      setApiDuration(null);
    }
  }, [isRecording]);

  useEffect(() => {
    if (isProcessing) {
      transcribeStartRef.current = Date.now();
    } else if (transcribeStartRef.current) {
      const duration = Date.now() - transcribeStartRef.current;
      transcribeStartRef.current = null;
      setApiDuration(duration);
      const timeout = setTimeout(() => setApiDuration(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [isProcessing]);

  if (isNativeConnected) return null;
  if (!isRecording && !isProcessing && apiDuration === null) return null;

  if (isRecording) {
    const speechInfo = speechDuration > 0
      ? ` ${speechDuration.toFixed(1)}s of speech detected${speaking ? ' — currently speaking' : ' — silence'}.`
      : ' Waiting for voice activity.';
    const doc = JSON.stringify({
      icon: 'mdi:microphone',
      title: 'Cloud STT — Listening',
      desc: `Browser microphone is active and recording.${speechInfo} VAD will auto-submit when you pause.`,
    });
    return (
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 cursor-default bg-violet-500 ${speaking ? 'animate-pulse' : ''}`}
        data-doc={doc}
      />
    );
  }

  if (isProcessing) {
    return (
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 cursor-default bg-blue-500 animate-pulse"
        data-doc='{"icon":"mdi:cloud-upload-outline","title":"Cloud STT — Transcribing","desc":"Audio is being sent to the cloud speech-to-text API. Waiting for the transcript to come back."}'
      />
    );
  }

  if (apiDuration !== null) {
    const doc = JSON.stringify({
      icon: 'mdi:check-circle-outline',
      title: 'Cloud STT — Done',
      desc: `Transcription complete in ${(apiDuration / 1000).toFixed(1)}s. The transcript has been submitted to the pipeline.`,
    });
    return (
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 cursor-default bg-teal-500"
        data-doc={doc}
      />
    );
  }

  return null;
}
