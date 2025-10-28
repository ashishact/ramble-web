import { useRef, useEffect, useState } from "react";

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

  // Auto-scroll to bottom when new transcripts arrive
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
    <div className="w-1/5 min-w-[300px] bg-black/30 backdrop-blur-md border-l border-white/10 flex flex-col h-screen">
      {/* Connection Status */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-white text-sm font-semibold">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Transcription Panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h2 className="text-xl font-bold text-white mb-3 sticky top-0 bg-black/50 backdrop-blur-sm py-2">
          Conversation
        </h2>
        {transcripts.length === 0 ? (
          <p className="text-gray-400 text-center text-sm mt-8">
            Start talking to see transcriptions...
          </p>
        ) : (
          transcripts.map((transcript, index) => (
            <div
              key={index}
              className={`p-3 rounded-lg text-sm ${
                transcript.role === 'user'
                  ? 'bg-blue-500/20 border border-blue-500/30'
                  : 'bg-purple-500/20 border border-purple-500/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-semibold ${
                    transcript.role === 'user'
                      ? 'text-blue-300'
                      : 'text-purple-300'
                  }`}
                >
                  {transcript.role === 'user' ? 'You' : 'AI'}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(transcript.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-white leading-relaxed">
                {transcript.text}
              </p>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* VAD Status */}
      {vadStatus && (
        <div className="p-3 border-t border-white/10 bg-black/20">
          <div className="text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Speaking:</span>
              <span
                className={vadStatus.userSpeaking ? "text-green-400" : "text-gray-500"}
              >
                {vadStatus.userSpeaking ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Last Speech:</span>
              <span className="text-white text-xs">
                {Math.floor((Date.now() - vadStatus.lastSpeechTime) / 1000)}s ago
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Last AI:</span>
              <span className="text-white text-xs">
                {Math.floor((Date.now() - vadStatus.lastGeminiTime) / 1000)}s ago
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Chat Input Section */}
      <div className="p-4 border-t border-white/10 bg-black/30">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            disabled={!isConnected}
            className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSendText}
            disabled={!isConnected || !textInput.trim()}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
        <button
          onClick={onToggleRecording}
          disabled={!isConnected}
          className={`w-full py-2 rounded-lg text-sm font-semibold transition-all ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-gray-700 hover:bg-gray-600 text-white"
          } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
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
  );
};
