/**
 * ConversationInput — Bottom text input with custom 2px caret
 *
 * Hides native 1px caret, renders a 2px primary-colored blinking bar
 * by measuring text width to the cursor position via canvas.
 * Accepts a forwarded ref so parent can focus on click-anywhere.
 */

import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { getKernel } from '../../../program/kernel/kernel';

// Singleton canvas for text measurement (never rendered)
const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d')!;

function getTextWidth(text: string, font: string): number {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export const ConversationInput = forwardRef<HTMLTextAreaElement>(
  function ConversationInput(_props, forwardedRef) {
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [caretLeft, setCaretLeft] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Expose textarea to parent for focus()
    useImperativeHandle(forwardedRef, () => textareaRef.current!);

    const updateCaret = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = el.selectionStart ?? 0;
      const before = el.value.substring(0, pos);
      const font = window.getComputedStyle(el).font;
      setCaretLeft(getTextWidth(before, font));
    }, []);

    const handleSubmit = useCallback(async () => {
      const trimmed = text.trim();
      if (!trimmed || isSubmitting) return;
      setIsSubmitting(true);
      setText('');
      setCaretLeft(0);
      try {
        await getKernel().submitInput(trimmed, 'text');
      } catch (err) {
        console.error('Failed to submit input:', err);
      } finally {
        setIsSubmitting(false);
        textareaRef.current?.focus();
      }
    }, [text, isSubmitting]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    // Track cursor position on any selection change (covers keyboard nav, clicks, etc.)
    useEffect(() => {
      const handler = () => {
        if (document.activeElement === textareaRef.current) {
          updateCaret();
        }
      };
      document.addEventListener('selectionchange', handler);
      return () => document.removeEventListener('selectionchange', handler);
    }, [updateCaret]);

    return (
      <div className="border-t border-base-200/60 px-8 py-2.5 bg-base-100 shrink-0">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              requestAnimationFrame(updateCaret);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCaret}
            onClick={updateCaret}
            onFocus={() => { setIsFocused(true); updateCaret(); }}
            onBlur={() => setIsFocused(false)}
            placeholder="Type something..."
            rows={1}
            disabled={isSubmitting}
            className="w-full bg-transparent text-base text-base-content/90 placeholder:text-base-content/25
                       resize-none outline-none leading-relaxed disabled:opacity-50"
            style={{ minHeight: '1.5em', maxHeight: '6em', caretColor: 'transparent' }}
          />
          {/* Custom 2px caret */}
          {isFocused && !isSubmitting && (
            <div
              className="absolute pointer-events-none animate-caretBlink rounded-full bg-primary"
              style={{
                left: `${caretLeft}px`,
                top: '0.15em',
                width: '2px',
                height: '1.15em',
              }}
            />
          )}
        </div>
      </div>
    );
  }
);
