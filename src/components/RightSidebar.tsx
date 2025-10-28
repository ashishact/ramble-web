import { useRef, useEffect, useState } from "react";
import { ThemeSelector } from "./ThemeSelector";

interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

interface RightSidebarProps {
  transcripts: TranscriptMessage[];
  isConnected: boolean;
  isRecording: boolean;
  onSendText: (text: string) => void;
  onToggleRecording: () => void;
  vadStatus?: {
    userSpeaking: boolean;
    lastSpeechTime: number;
    lastGeminiTime: number;
  };
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  transcripts,
  isConnected,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus,
}) => {
  const [textInput, setTextInput] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const handleSendText = () => {
    if (textInput.trim() && isConnected) {
      onSendText(textInput.trim());
      setTextInput("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  return (
    <div className="w-1/5 min-w-[300px] bg-base-200/80 backdrop-blur-md border-l border-base-300 flex flex-col h-screen">
      {/* Connection Status & Theme Selector */}
      <div className="card bg-base-100/50 rounded-none border-b border-base-300">
        <div className="card-body p-4">
          <div className="flex items-center justify-between">
            <div className="indicator">
              <span className={`indicator-item badge ${isConnected ? "badge-success" : "badge-error"} badge-xs`}></span>
              <span className="text-base-content text-sm font-semibold ml-4">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <ThemeSelector />
          </div>
        </div>
      </div>

      {/* Transcription Panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h2 className="text-xl font-bold text-base-content mb-3 sticky top-0 bg-base-200/80 backdrop-blur-sm py-2">
          Conversation
        </h2>
        {transcripts.length === 0 ? (
          <p className="text-base-content/60 text-center text-sm mt-8">
            Start talking to see transcriptions...
          </p>
        ) : (
          <div className="chat-box">
            {transcripts.map((transcript, index) => (
              <div
                key={index}
                className={`chat ${transcript.role === 'user' ? 'chat-end' : 'chat-start'}`}
              >
                <div className="chat-header flex items-center gap-2 mb-1">
                  <span className="badge badge-sm">
                    {transcript.role === 'user' ? 'You' : 'AI'}
                  </span>
                  <time className="text-xs opacity-50">
                    {new Date(transcript.timestamp).toLocaleTimeString()}
                  </time>
                </div>
                <div className={`chat-bubble ${transcript.role === 'user' ? 'chat-bubble-primary' : 'chat-bubble-secondary'}`}>
                  {transcript.text}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* VAD Status */}
      {vadStatus && (
        <div className="card bg-base-100/50 rounded-none border-t border-base-300">
          <div className="card-body p-3">
            <div className="text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Speaking:</span>
                <span className={`badge badge-sm ${vadStatus.userSpeaking ? "badge-success" : "badge-ghost"}`}>
                  {vadStatus.userSpeaking ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Last Speech:</span>
                <span className="text-base-content text-xs">
                  {Math.floor((Date.now() - vadStatus.lastSpeechTime) / 1000)}s ago
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Last AI:</span>
                <span className="text-base-content text-xs">
                  {Math.floor((Date.now() - vadStatus.lastGeminiTime) / 1000)}s ago
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Input Section */}
      <div className="card bg-base-100/50 rounded-none border-t border-base-300">
        <div className="card-body p-4">
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              disabled={!isConnected}
              className="input input-bordered flex-1 text-sm"
            />
            <button
              onClick={handleSendText}
              disabled={!isConnected || !textInput.trim()}
              className="btn btn-primary btn-sm"
            >
              Send
            </button>
          </div>
          <button
            onClick={onToggleRecording}
            disabled={!isConnected}
            className={`btn btn-sm w-full ${
              isRecording ? "btn-error" : "btn-neutral"
            }`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            {isRecording ? "Stop Recording" : "Start Recording"}
          </button>
        </div>
      </div>
    </div>
  );
};
