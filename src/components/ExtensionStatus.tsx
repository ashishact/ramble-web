/**
 * ExtensionStatus - Visual indicator for Chrome extension presence
 *
 * Tiny puzzle icon — green when extension heartbeat is active, grey when absent.
 * Click to toggle enabled/disabled. When disabled, shows a yellow pause overlay
 * (distinct from "not connected" grey).
 * Hover triggers HelpStrip doc at the bottom of the screen.
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Puzzle, Pause } from 'lucide-react';
import { rambleExt } from '../modules/chrome-extension';
import { getExtensionEnabled, setExtensionEnabled, subscribe } from '../lib/serviceToggles';

export function ExtensionStatus() {
  const enabled = useSyncExternalStore(subscribe, getExtensionEnabled);
  const [available, setAvailable] = useState(rambleExt.isAvailable);

  useEffect(() => {
    // Poll every 3s to catch availability changes (mirrors heartbeat check)
    const timer = setInterval(() => {
      setAvailable(rambleExt.isAvailable);
    }, 3000);

    const unsub = rambleExt.onAvailabilityChange(setAvailable);

    return () => {
      clearInterval(timer);
      unsub();
    };
  }, []);

  const handleClick = () => setExtensionEnabled(!enabled);

  if (!enabled) {
    return (
      <span
        className="relative flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={handleClick}
        data-doc='{"icon":"mdi:puzzle-off-outline","title":"Chrome Extension (Disabled)","desc":"Extension disabled — click to enable. SYS-I uses API conversation transport while disabled."}'
      >
        <Puzzle size={12} className="text-base-content/20" />
        <Pause size={7} className="absolute -bottom-[1px] -right-[1px] text-warning" />
      </span>
    );
  }

  if (available) {
    return (
      <span
        className="flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={handleClick}
        data-doc='{"icon":"mdi:puzzle-outline","title":"Chrome Extension","desc":"Ramble Chrome extension connected. ChatGPT conversation transport is available. Click to disable."}'
      >
        <Puzzle size={12} className="text-green-500" />
      </span>
    );
  }

  return (
    <span
      className="flex items-center justify-center flex-shrink-0 cursor-pointer"
      onClick={handleClick}
      data-doc='{"icon":"mdi:puzzle-off-outline","title":"Chrome Extension","desc":"Chrome extension not detected. SYS-I will use the API conversation transport (Gemini). Click to disable."}'
    >
      <Puzzle size={12} className="text-slate-300" />
    </span>
  );
}
