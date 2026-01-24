/**
 * VoiceRecorderWidget - Visual display for global STT state
 *
 * This widget shows the current recording state and provides a button to toggle recording.
 * The actual STT logic is handled by GlobalSTTController.
 */

import type { WidgetProps } from '../types';
import { useGlobalSTT } from '../../components/GlobalSTTController';

export const VoiceRecorderWidget: React.FC<WidgetProps> = () => {
  const { isRecording, isProcessing, transcript, toggleRecording } = useGlobalSTT();

  return (
    <div className="w-full h-full p-3 flex flex-col">
      <div className="flex flex-col gap-2">
        {/* Recording Button */}
        <button
          className={`btn btn-sm ${isRecording ? 'btn-error animate-pulse' : 'btn-primary'} gap-1`}
          onClick={toggleRecording}
          disabled={isProcessing}
          title="Toggle recording (Right ⌘)"
        >
          {isRecording ? (
            <>
              <span className="w-2 h-2 rounded-full bg-white"></span>
              Stop
            </>
          ) : isProcessing ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
              Record
            </>
          )}
        </button>

        {/* Live Transcript */}
        {(transcript || isRecording) && (
          <div className="bg-base-200 p-2 rounded text-sm flex items-center gap-2">
            {isRecording && <span className="loading loading-dots loading-xs text-error"></span>}
            <span className="opacity-70 italic">{transcript || 'Listening...'}</span>
          </div>
        )}

        {/* Keyboard hint */}
        <div className="text-[10px] text-slate-400 mt-1">
          Press <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">Right ⌘</kbd> to toggle
        </div>
      </div>
    </div>
  );
};
