import { useState, useCallback } from 'react';
import type { WidgetProps } from '../types';
import { useKernel } from '../../program/hooks';
import { Send } from 'lucide-react';

export const TextInputWidget: React.FC<WidgetProps> = () => {
  const { isInitialized, isProcessing, submitInput } = useKernel();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isProcessing) return;
    setError(null);

    try {
      await submitInput(text.trim());
      setText('');
    } catch (err) {
      console.error('Processing failed:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
    }
  }, [text, isProcessing, submitInput]);

  if (!isInitialized) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
        Initializing...
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col">
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type something..."
          className="flex-1 w-full p-3 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isProcessing}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-400">
            {isProcessing ? 'Processing...' : 'Press Enter to submit'}
          </span>
          <button
            type="submit"
            disabled={!text.trim() || isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={12} />
            Send
          </button>
        </div>
      </form>
      {error && (
        <div className="mt-2 p-2 bg-red-50 text-red-600 text-xs rounded">
          {error}
        </div>
      )}
    </div>
  );
};
