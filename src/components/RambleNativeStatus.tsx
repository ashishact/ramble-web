/**
 * RambleNativeStatus - Visual indicator for Ramble native app state
 *
 * Dot-only. Hover triggers HelpStrip doc at the bottom of the screen.
 *
 * isActiveSession bridges the recording → transcribing → done cycle:
 * it turns on when 'recording' starts and only turns off at 'done' or 'idle',
 * so the animated dots stay visible through the full utterance lifecycle.
 */

import { useState, useEffect } from 'react';
import { rambleNative, type RambleNativeState } from '../services/stt/rambleNative';

export function RambleNativeStatus() {
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

  if (!isConnected) {
    return (
      <span
        className="w-6 flex items-center justify-center flex-shrink-0 cursor-default"
        data-doc='{"icon":"mdi:connection-off","title":"Ramble Native","desc":"Desktop companion app not connected. Start the Ramble native app to enable local microphone recording."}'
      >
        <span className="w-2 h-2 rounded-full bg-slate-300" />
      </span>
    );
  }

  if (isActiveSession) {
    return (
      <span
        className="w-6 flex items-center justify-center gap-0.5 flex-shrink-0 cursor-default"
        data-doc='{"icon":"mdi:record-circle","title":"Recording","desc":"Ramble Native is capturing audio from your microphone."}'
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce [animation-delay:300ms]" />
      </span>
    );
  }

  const getDisplay = (): { color: string; animate: boolean; doc: string } => {
    switch (state) {
      case 'transcribing':
        return {
          color: 'bg-amber-500',
          animate: true,
          doc: '{"icon":"mdi:text-recognition","title":"Transcribing","desc":"Ramble Native is converting your speech to text locally."}',
        };
      case 'done':
        return {
          color: 'bg-green-500',
          animate: false,
          doc: '{"icon":"mdi:check-circle-outline","title":"Done","desc":"Ramble Native finished processing the last recording. Waiting for next input."}',
        };
      case 'idle':
      default:
        return {
          color: 'bg-green-500',
          animate: false,
          doc: '{"icon":"mdi:microphone-outline","title":"Ramble Native Ready","desc":"Desktop companion app connected. Listening for voice activity — speak to start recording."}',
        };
    }
  };

  const { color, animate, doc } = getDisplay();

  return (
    <span
      className="w-6 flex items-center justify-center flex-shrink-0 cursor-default"
      data-doc={doc}
    >
      <span className={`w-2 h-2 rounded-full ${color} ${animate ? 'animate-pulse' : ''}`} />
    </span>
  );
}
