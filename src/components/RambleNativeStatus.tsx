/**
 * RambleNativeStatus - Visual indicator for Ramble native app state
 *
 * Tiny mic icon — green when connected, grey when absent.
 * Click to toggle enabled/disabled. When disabled, shows a yellow pause overlay
 * (distinct from "not connected" grey).
 * Hover triggers HelpStrip doc at the bottom of the screen.
 *
 * isActiveSession bridges the recording → transcribing → done cycle:
 * it turns on when 'recording' starts and only turns off at 'done' or 'idle',
 * so the animated dots stay visible through the full utterance lifecycle.
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Mic, Pause } from 'lucide-react';
import { rambleNative, type RambleNativeState } from '../services/stt/rambleNative';
import { getNativeEnabled, setNativeEnabled, subscribe } from '../lib/serviceToggles';

export function RambleNativeStatus() {
  const enabled = useSyncExternalStore(subscribe, getNativeEnabled);
  const [isConnected, setIsConnected] = useState(rambleNative.isRambleAvailable());
  const [state, setState] = useState<RambleNativeState | null>(rambleNative.getState());
  const [isActiveSession, setIsActiveSession] = useState(false);

  useEffect(() => {
    rambleNative.setCallbacks({
      onConnectionChange: setIsConnected,
      onStateChange: (newState) => {
        setState(newState);
        if (newState === 'recording') {
          setIsActiveSession(true);
        } else if (newState === 'done' || newState === 'idle' || newState === 'error' || newState === null) {
          setIsActiveSession(false);
        }
        // 'transcribing' and 'enhancing' leave isActiveSession unchanged —
        // they are still part of the same utterance cycle
      },
    });
    return () => rambleNative.clearCallbacks();
  }, []);

  const handleClick = () => setNativeEnabled(!enabled);

  if (!enabled) {
    return (
      <span
        className="relative flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={handleClick}
        data-doc='{"icon":"mdi:microphone-off","title":"Ramble Native (Disabled)","desc":"Native app disabled — click to enable. Voice recorder will fall back to cloud STT."}'
      >
        <Mic size={12} className="text-base-content/20" />
        <Pause size={7} className="absolute -bottom-[1px] -right-[1px] text-warning" />
      </span>
    );
  }

  if (!isConnected) {
    return (
      <span
        className="flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={handleClick}
        data-doc='{"icon":"mdi:connection-off","title":"Ramble Native","desc":"Desktop companion app not connected. Start the Ramble native app to enable local microphone recording. Click to disable."}'
      >
        <Mic size={12} className="text-slate-300" />
      </span>
    );
  }

  if (isActiveSession) {
    return (
      <span
        className="flex items-center justify-center gap-0.5 flex-shrink-0 cursor-pointer"
        onClick={handleClick}
        data-doc='{"icon":"mdi:record-circle","title":"Recording","desc":"Ramble Native is capturing audio from your microphone. Click to disable."}'
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:300ms]" />
      </span>
    );
  }

  const getDisplay = (): { className: string; doc: string } => {
    switch (state) {
      case 'transcribing':
        return {
          className: 'text-amber-500 animate-pulse',
          doc: '{"icon":"mdi:text-recognition","title":"Transcribing","desc":"Ramble Native is converting your speech to text locally. Click to disable."}',
        };
      case 'done':
        return {
          className: 'text-green-500',
          doc: '{"icon":"mdi:check-circle-outline","title":"Done","desc":"Ramble Native finished processing the last recording. Waiting for next input. Click to disable."}',
        };
      case 'idle':
      default:
        return {
          className: 'text-green-500',
          doc: '{"icon":"mdi:microphone-outline","title":"Ramble Native Ready","desc":"Desktop companion app connected. Listening for voice activity — speak to start recording. Click to disable."}',
        };
    }
  };

  const { className, doc } = getDisplay();

  return (
    <span
      className="flex items-center justify-center flex-shrink-0 cursor-pointer"
      onClick={handleClick}
      data-doc={doc}
    >
      <Mic size={12} className={className} />
    </span>
  );
}
