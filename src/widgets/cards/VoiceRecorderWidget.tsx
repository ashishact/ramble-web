import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WidgetProps } from '../types';
import { VoiceRecorder } from '../../components/v2/VoiceRecorder';
import { useKernel } from '../../program/hooks';

export const VoiceRecorderWidget: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();
  const { isInitialized, isProcessing, submitInput } = useKernel();
  const [error, setError] = useState<string | null>(null);

  const handleTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setError(null);

    try {
      await submitInput(text.trim());
    } catch (err) {
      console.error('Processing failed:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
    }
  }, [submitInput]);

  const handleMissingApiKey = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  if (!isInitialized) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
        Initializing...
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col">
      <VoiceRecorder
        onTranscript={handleTranscript}
        onMissingApiKey={handleMissingApiKey}
        disabled={isProcessing}
      />
      {error && (
        <div className="mt-2 p-2 bg-red-50 text-red-600 text-xs rounded">
          {error}
        </div>
      )}
    </div>
  );
};
