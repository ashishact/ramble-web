/**
 * TranscriptReview - Simple editable overlay for reviewing STT transcript
 *
 * Shows the transcript in an editable textarea.
 * No suggestions, no auto-corrections — just let the user edit and submit.
 *
 * - Enter: submit
 * - Shift+Enter: new line
 * - Escape / backdrop click: cancel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Focus, X } from 'lucide-react';
import { settingsHelpers } from '../stores/settingsStore';

/**
 * Ramble metadata from clipboard (compact format)
 *
 * HTML format:
 *   <span data-ramble='{"s":"ramble","v":"1.9","ts":1706367000000,"t":"t","d":5.2}'>Hello world</span>
 *
 * Keys:
 *   s   - source (always "ramble")
 *   v   - version
 *   ts  - timestamp (unix ms)
 *   t   - type: "t"=transcription, "x"=transformation
 *   d   - duration in seconds (optional)
 */
export interface RambleMetadata {
  source: string;
  version: string;
  timestamp: number;
  type: 'transcription' | 'transformation';
  duration?: number;
}

interface TranscriptReviewProps {
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  rambleMetadata?: RambleMetadata | null;
  targetLensName?: string | null;
}

export function TranscriptReview({ initialText, onSubmit, onCancel, rambleMetadata, targetLensName }: TranscriptReviewProps) {
  const [text, setText] = useState(initialText);
  const [reviewDisabled, setReviewDisabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const finalText = text.trim();
    if (!finalText) return;
    onSubmit(finalText);
  }, [text, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, onCancel]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel]
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Lens target indicator */}
        {targetLensName && (
          <div className="px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2">
            <Focus size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              Sending to <span className="font-semibold">{targetLensName}</span>
            </span>
            <span className="text-[10px] text-amber-500 ml-1">(not saved to history)</span>
          </div>
        )}

        {/* Ramble metadata bar */}
        {rambleMetadata && (
          <div className="px-4 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-purple-600">
              <Mic size={14} />
              <span className="text-xs font-semibold capitalize">{rambleMetadata.source}</span>
              <span className="text-[10px] text-purple-400">v{rambleMetadata.version}</span>
            </div>
            <div className="h-3 w-px bg-purple-200" />
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="capitalize">{rambleMetadata.type}</span>
              {rambleMetadata.duration && (
                <span>
                  <span className="text-slate-400">Duration:</span>{' '}
                  {rambleMetadata.duration.toFixed(1)}s
                </span>
              )}
            </div>
            <div className="ml-auto">
              {reviewDisabled ? (
                <span className="text-[10px] text-purple-400">
                  Skipping next time — re-enable in <span className="font-medium">Settings → Advanced</span>
                </span>
              ) : (
                <button
                  onClick={() => {
                    settingsHelpers.setReviewEnabled(false);
                    setReviewDisabled(true);
                  }}
                  className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-600 transition-colors"
                >
                  <X size={10} />
                  <span>Skip review for Ramble input</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Text editor */}
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full min-h-[120px] max-h-[50vh] resize-none focus:outline-none text-base leading-relaxed text-slate-800 placeholder:text-slate-400"
            placeholder="Edit your transcript..."
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Enter</kbd>
            {' '}submit
            <span className="mx-2">·</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Shift+Enter</kbd>
            {' '}new line
            <span className="mx-2">·</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">Esc</kbd>
            {' '}cancel
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-200 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-3 py-1 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
