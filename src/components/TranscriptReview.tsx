/**
 * TranscriptReview - Centered overlay for reviewing/editing transcript before submission
 *
 * Features:
 * - Enter: Submit
 * - Shift+Enter: New line
 * - Escape: Cancel/dismiss
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface TranscriptReviewProps {
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function TranscriptReview({ initialText, onSubmit, onCancel }: TranscriptReviewProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus and select all on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
    }
  }, [text]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text.trim());
      }
      return;
    }
    // Shift+Enter allows default behavior (new line)
  }, [text, onSubmit, onCancel]);

  // Handle click outside to cancel
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-xl mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full p-4 text-base leading-relaxed resize-none focus:outline-none min-h-[80px]"
          placeholder="Edit transcript..."
        />
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Enter</kbd> to submit
            <span className="mx-2">|</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Shift+Enter</kbd> new line
            <span className="mx-2">|</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Esc</kbd> cancel
          </span>
        </div>
      </div>
    </div>
  );
}

// Global state for showing the transcript review
type TranscriptCallback = (text: string) => void;

let showReviewFn: ((text: string, onSubmit: TranscriptCallback) => void) | null = null;

export function registerTranscriptReview(fn: (text: string, onSubmit: TranscriptCallback) => void) {
  showReviewFn = fn;
}

export function showTranscriptReview(text: string, onSubmit: TranscriptCallback) {
  if (showReviewFn) {
    showReviewFn(text, onSubmit);
  } else {
    // Fallback: directly submit if review not registered
    console.warn('[TranscriptReview] Not registered, submitting directly');
    onSubmit(text);
  }
}
