/**
 * useRamblePaste - Global paste event handler for Ramble STT
 *
 * When Ramble is available, it handles speech-to-text and pastes the
 * transcription into the focused application. This hook captures those
 * paste events and sends the text to the processing pipeline.
 *
 * Key behaviors:
 * - Only captures paste when Ramble is available
 * - Doesn't intercept paste events when an input element is focused
 *   (lets the paste go into the input naturally)
 * - Registers listener once on mount, checks ramble state inside handler
 * - Parses Ramble metadata from HTML clipboard if available
 */

import { useEffect, useRef } from 'react';
import { rambleNative } from '../services/stt/rambleNative';
import { showTranscriptReview, type RambleMetadata } from '../components/TranscriptReview';

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

export function useRamblePaste(onTranscript: (text: string) => void): void {
  // Use ref to always have latest callback without re-registering listener
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Only handle paste when ramble is available
      if (!rambleNative.isRambleAvailable()) return;

      // Don't intercept if an input element is focused - let paste happen naturally
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement as HTMLElement)?.isContentEditable
      ) {
        return; // Let the paste go into the input normally
      }

      const text = event.clipboardData?.getData('text');
      if (!text) return;

      // Prevent default only for non-input elements
      event.preventDefault();

      // Check for HTML content with Ramble metadata
      const html = event.clipboardData?.getData('text/html') || '';
      const rambleMetadata = parseRambleMetadata(html);

      if (rambleMetadata) {
        console.log('[useRamblePaste] Detected Ramble paste with metadata:', rambleMetadata);
      } else {
        console.log('[useRamblePaste] Captured paste (no Ramble metadata):', text.slice(0, 50) + '...');
      }

      // Show transcript review overlay with metadata if available
      showTranscriptReview(text.trim(), (reviewedText) => {
        callbackRef.current(reviewedText);
      }, rambleMetadata);
    };

    // Register ONCE on mount
    document.addEventListener('paste', handlePaste);

    // Cleanup only on unmount (component destroyed)
    return () => document.removeEventListener('paste', handlePaste);
  }, []); // Empty deps - register once only
}
