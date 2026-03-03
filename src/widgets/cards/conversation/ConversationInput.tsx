/**
 * ConversationInput — Bottom text input for conversation widget
 */

import { useState, useCallback, useRef } from 'react';
import { getKernel } from '../../../program/kernel/kernel';

export function ConversationInput() {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    setText('');
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

  return (
    <div className="border-t border-base-200/60 px-8 py-2.5 bg-base-100 shrink-0">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type something..."
        rows={1}
        disabled={isSubmitting}
        className="w-full bg-transparent text-base text-base-content/90 placeholder:text-base-content/25
                   resize-none outline-none leading-relaxed disabled:opacity-50"
        style={{ minHeight: '1.5em', maxHeight: '6em', caretColor: 'oklch(var(--p))' }}
      />
    </div>
  );
}
