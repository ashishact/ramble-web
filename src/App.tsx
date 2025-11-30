import { useMemo } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { VoiceActivityMonitor } from "./components/VoiceActivityMonitor";
import { AgentView } from "./components/AgentView";
import { RightSidebar } from "./components/RightSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { CloudflareAIGatewayTest } from "./components/CloudflareAIGatewayTest";
import { SpeechToTextTest } from "./components/SpeechToTextTest";
import { useVoiceAgent } from "./hooks/useVoiceAgent";

export interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

function MainPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const agent = searchParams.get('agent') || 'amigoz';

  // Voice Agent - connects to Gemini Live (System I) and Observer Agent (System II)
  const {
    isConnected,
    isConnecting,
    connectionError,
    isRecording,
    isListening,
    isPlaying,
    observerStatus,
    observerMessages,
    currentUserTranscript,
    currentModelTranscript,
    recentMessages,
    sendText,
    toggleRecording,
  } = useVoiceAgent();

  // Convert recentMessages to TranscriptMessage format for components
  const transcripts: TranscriptMessage[] = useMemo(() => {
    const msgs = recentMessages.map(msg => ({
      role: msg.role,
      text: msg.content,
      timestamp: new Date(msg.timestamp).getTime(),
      isComplete: msg.isComplete,
    }));

    // Add current streaming transcripts if any
    if (currentUserTranscript) {
      msgs.push({
        role: 'user' as const,
        text: currentUserTranscript,
        timestamp: Date.now(),
        isComplete: false,
      });
    }
    if (currentModelTranscript) {
      msgs.push({
        role: 'model' as const,
        text: currentModelTranscript,
        timestamp: Date.now(),
        isComplete: false,
      });
    }

    return msgs;
  }, [recentMessages, currentUserTranscript, currentModelTranscript]);

  // VAD status for components
  const vadStatus = useMemo(() => ({
    userSpeaking: isListening,
    lastSpeechTime: Date.now(),
    lastGeminiTime: isPlaying ? Date.now() : Date.now() - 1000,
  }), [isListening, isPlaying]);

  // Custom events for AgentView
  const customEvents = useMemo(() => {
    if (observerStatus.status === 'processing') {
      return { event: 'observer-processing', data: observerStatus.description };
    }
    return null;
  }, [observerStatus]);

  // Handle VAD status change (for future use)
  const handleVadStatusChange = (_shouldSend: boolean) => {
    // VAD is handled internally by Gemini Live now
  };

  const handleUserSpeakingChange = (_isSpeaking: boolean) => {
    // User speaking is tracked by Gemini Live transcription
  };

  // Show connection error if any
  const effectiveIsConnected = isConnected || isConnecting;

  return (
    <div className="h-screen bg-base-300 flex overflow-hidden">
      {/* Connection error banner */}
      {connectionError && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-error text-error-content px-4 py-2 text-center">
          {connectionError}
          <button
            className="ml-4 btn btn-xs btn-ghost"
            onClick={() => navigate('/settings')}
          >
            Configure API Key
          </button>
        </div>
      )}

      {/* For amigoz agent: full-width 3-panel layout (D3, Nodes, Chat) */}
      {agent === 'amigoz' ? (
        <AgentView
          agent={agent}
          isConnected={effectiveIsConnected}
          customEvents={customEvents}
          transcripts={transcripts}
          observerMessages={observerMessages}
          observerStatus={observerStatus}
          isRecording={isRecording}
          onSendText={sendText}
          onToggleRecording={toggleRecording}
          vadStatus={vadStatus}
          onOpenSettings={() => navigate('/settings')}
        />
      ) : (
        <>
          {/* For other agents: traditional layout with sidebar */}
          <div className="flex-1 w-4/5 overflow-auto bg-base-100">
            <AgentView
              agent={agent}
              isConnected={effectiveIsConnected}
              customEvents={customEvents}
              transcripts={transcripts}
              isRecording={isRecording}
              onSendText={sendText}
              onToggleRecording={toggleRecording}
              vadStatus={vadStatus}
              onOpenSettings={() => navigate('/settings')}
            />
          </div>

          {/* Right Sidebar - Chat & Transcription (1/5) */}
          <RightSidebar
            transcripts={transcripts}
            observerMessages={observerMessages}
            observerStatus={observerStatus}
            isConnected={effectiveIsConnected}
            isRecording={isRecording}
            onSendText={sendText}
            onToggleRecording={toggleRecording}
            vadStatus={vadStatus}
            onOpenSettings={() => navigate('/settings')}
          />
        </>
      )}

      {/* Hidden VAD Monitor - kept for potential future use */}
      <div className="hidden">
        <VoiceActivityMonitor
          isActive={isRecording}
          onShouldSendChange={handleVadStatusChange}
          onUserSpeakingChange={handleUserSpeakingChange}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/settings" element={<SettingsPage onBack={() => window.history.back()} />} />
        <Route path="/cf-gateway-test" element={<CloudflareAIGatewayTest />} />
        <Route path="/stt-test" element={<SpeechToTextTest />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
