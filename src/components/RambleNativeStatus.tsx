/**
 * RambleNativeStatus - Visual indicator for Ramble native app state
 *
 * Shows connection status and current state (recording, transcribing, etc.)
 * of the Ramble native desktop application.
 *
 * Designed to fit inside the header (h-9 = 36px).
 */

import { useState, useEffect } from 'react';
import { rambleNative, type RambleNativeState } from '../services/stt/rambleNative';

export function RambleNativeStatus() {
  const [isConnected, setIsConnected] = useState(rambleNative.isRambleAvailable());
  const [state, setState] = useState<RambleNativeState | null>(rambleNative.getState());

  useEffect(() => {
    rambleNative.setCallbacks({
      onConnectionChange: setIsConnected,
      onStateChange: setState,
    });

    return () => {
      rambleNative.clearCallbacks();
    };
  }, []);

  // Not connected - show subtle disconnected indicator
  if (!isConnected) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400"
        title="Ramble native app not connected"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        <span className="hidden sm:inline">Native</span>
      </div>
    );
  }

  // Connected - show state
  const getStateDisplay = () => {
    switch (state) {
      case 'recording':
        return {
          color: 'bg-red-500',
          text: 'Recording',
          animate: true,
        };
      case 'transcribing':
        return {
          color: 'bg-amber-500',
          text: 'Transcribing',
          animate: true,
        };
      case 'done':
        return {
          color: 'bg-green-500',
          text: 'Done',
          animate: false,
        };
      case 'idle':
      default:
        return {
          color: 'bg-green-500',
          text: 'Ready',
          animate: false,
        };
    }
  };

  const { color, text, animate } = getStateDisplay();

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-600"
      title={`Ramble native: ${text}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${color} ${animate ? 'animate-pulse' : ''}`}
      />
      <span className="hidden sm:inline">{text}</span>
    </div>
  );
}
