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
 */

import { useEffect, useRef } from 'react';
import { rambleChecker } from '../services/stt/rambleChecker';
import { showTranscriptReview } from '../components/TranscriptReview';

export function useRamblePaste(onTranscript: (text: string) => void): void {
  // Use ref to always have latest callback without re-registering listener
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Only handle paste when ramble is available
      if (!rambleChecker.isRambleAvailable()) return;

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

      console.log('[useRamblePaste] Captured paste, showing review:', text.slice(0, 50) + '...');

      // Show transcript review overlay instead of direct submit
      showTranscriptReview(text.trim(), (reviewedText) => {
        callbackRef.current(reviewedText);
      });
    };

    // Register ONCE on mount
    document.addEventListener('paste', handlePaste);

    // Cleanup only on unmount (component destroyed)
    return () => document.removeEventListener('paste', handlePaste);
  }, []); // Empty deps - register once only
}
