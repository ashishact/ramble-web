import { useRef, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { ThemeSelector } from "./ThemeSelector";
import type { ObserverMessage } from "../services/observerAgentAI";

interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

interface RightSidebarProps {
  transcripts: TranscriptMessage[];
  observerMessages?: ObserverMessage[];
  observerStatus?: { status: string; description: string };
  isConnected: boolean;
  isRecording: boolean;
  onSendText: (text: string) => void;
  onToggleRecording: () => void;
  vadStatus?: {
    userSpeaking: boolean;
    lastSpeechTime: number;
    lastGeminiTime: number;
  };
  onOpenSettings?: () => void;
}

type ChatView = 'conversation' | 'observer';

export const RightSidebar: React.FC<RightSidebarProps> = ({
  transcripts,
  observerMessages = [],
  observerStatus,
  isConnected,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus,
  onOpenSettings,
}) => {
  const [textInput, setTextInput] = useState("");
  const [activeView, setActiveView] = useState<ChatView>('conversation');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const observerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeView === 'conversation') {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts, activeView]);

  useEffect(() => {
    if (activeView === 'observer') {
      observerEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [observerMessages, activeView]);

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

  const renderObserverMessage = (msg: ObserverMessage, index: number) => {
    const isUser = msg.role === 'user';
    const isTool = msg.role === 'tool';

    if (isTool) {
      // Render tool calls as compact cards
      return (
        <div key={index} className="my-2">
          <div className="bg-base-300/50 rounded-lg p-2 text-xs">
            <div className="flex items-center gap-1 mb-1">
              <Icon icon="mdi:tools" className="w-3 h-3 text-info" />
              <span className="font-mono text-info">{msg.toolName}</span>
            </div>
            <pre className="text-base-content/70 overflow-x-auto whitespace-pre-wrap break-all">
              {msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content}
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div
        key={index}
        className={`chat ${isUser ? 'chat-end' : 'chat-start'}`}
      >
        <div className="chat-header flex items-center gap-2 mb-1">
          <span className={`badge badge-sm ${isUser ? 'badge-primary' : 'badge-secondary'}`}>
            {isUser ? 'Input' : 'Observer'}
          </span>
          <time className="text-xs opacity-50">
            {msg.timestamp.toLocaleTimeString()}
          </time>
        </div>
        <div className={`chat-bubble text-sm ${isUser ? 'chat-bubble-primary' : 'chat-bubble-secondary'}`}>
          {msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}
        </div>
      </div>
    );
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
          <div className="flex items-center gap-1">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="btn btn-ghost btn-sm btn-square"
                title="Settings"
              >
                <Icon icon="mdi:cog" className="w-5 h-5" />
              </button>
            )}
            <ThemeSelector />
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="tabs tabs-boxed bg-base-100/50 mx-4 mt-2">
        <button
          className={`tab tab-sm flex-1 gap-1 ${activeView === 'conversation' ? 'tab-active' : ''}`}
          onClick={() => setActiveView('conversation')}
        >
          <Icon icon="mdi:chat" className="w-4 h-4" />
          Chat
        </button>
        <button
          className={`tab tab-sm flex-1 gap-1 ${activeView === 'observer' ? 'tab-active' : ''}`}
          onClick={() => setActiveView('observer')}
        >
          <Icon icon="mdi:brain" className="w-4 h-4" />
          Observer
          {observerStatus?.status === 'processing' && (
            <span className="loading loading-spinner loading-xs ml-1"></span>
          )}
        </button>
      </div>

      {/* Content Panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeView === 'conversation' ? (
          // Main Conversation View
          <>
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
          </>
        ) : (
          // Observer View
          <>
            {observerStatus && (
              <div className="mb-3">
                <div className={`badge gap-1 ${
                  observerStatus.status === 'processing' ? 'badge-info' :
                  observerStatus.status === 'completed' ? 'badge-success' :
                  observerStatus.status === 'failed' ? 'badge-error' :
                  'badge-ghost'
                }`}>
                  {observerStatus.status === 'processing' && (
                    <span className="loading loading-spinner loading-xs"></span>
                  )}
                  {observerStatus.description}
                </div>
              </div>
            )}
            {observerMessages.length === 0 ? (
              <p className="text-base-content/60 text-center text-sm mt-8">
                Observer agent processing will appear here...
              </p>
            ) : (
              <div className="chat-box">
                {observerMessages.map((msg, index) => renderObserverMessage(msg, index))}
              </div>
            )}
            <div ref={observerEndRef} />
          </>
        )}
      </div>

      {/* VAD Status */}
      {vadStatus && activeView === 'conversation' && (
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
            className={`btn btn-sm w-full gap-2 ${
              isRecording ? "btn-error" : isConnected ? "btn-neutral" : "btn-primary"
            }`}
          >
            <Icon icon={isRecording ? "mdi:microphone-off" : "mdi:microphone"} className="w-4 h-4" />
            {isRecording ? "Stop Recording" : isConnected ? "Start Recording" : "Start Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
};
