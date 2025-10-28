import { useRef, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
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
      {/* Header */}
      <div className="bg-base-100/50 border-b border-base-300 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`badge ${isConnected ? "badge-success" : "badge-error"} badge-sm`}></span>
            <h1 className="text-lg font-bold text-base-content truncate">Knowledge Graph</h1>
          </div>
          <ThemeSelector />
        </div>
      </div>

      {/* Transcription Panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            className={`btn btn-sm w-full gap-2 ${
              isRecording ? "btn-error" : "btn-neutral"
            }`}
          >
            <Icon icon={isRecording ? "mdi:microphone-off" : "mdi:microphone"} className="w-4 h-4" />
            {isRecording ? "Stop Recording" : "Start Recording"}
          </button>
        </div>
      </div>
    </div>
  );
};
