import { useEffect, useState, useRef } from "react";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useGeminiSocket } from "./hooks/useGeminiSocket";
import { VoiceActivityMonitor, notifyGeminiResponse } from "./components/VoiceActivityMonitor";
import { AgentView } from "./components/AgentView";
import { RightSidebar } from "./components/RightSidebar";
import { ThemeSelector } from "./components/ThemeSelector";

interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

function App() {
  // Parse agent from URL query params
  const [agent, setAgent] = useState<string>('health');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agentParam = params.get('agent');
    if (agentParam) {
      setAgent(agentParam);
    }
  }, []);

  const [isActive, setIsActive] = useState(false);
  const [shouldSendAudio, setShouldSendAudio] = useState(true);
  const shouldSendAudioRef = useRef(true);
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [customEvents, setCustomEvents] = useState<{ event: string; data: any } | null>(null);
  const transcriptionBuffer = useRef({ userText: '', modelText: '' });
  const [vadStatus, setVadStatus] = useState({
    userSpeaking: false,
    lastSpeechTime: Date.now(),
    lastGeminiTime: Date.now(),
  });
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();
  const { playAudio, stopAudio } = useAudioPlayer();

  const { isConnected, sendAudioData, sendTextMessage, onMessage } = useGeminiSocket(agent);

  useEffect(() => {
    onMessage((message) => {
      notifyGeminiResponse();

      // Handle custom events from agents
      if (message.customEvent) {
        setCustomEvents({ event: message.customEvent, data: message.data });
      }

      // Accumulate and show transcription chunks in real-time
      if (message.serverContent?.inputTranscription?.text) {
        transcriptionBuffer.current.userText += message.serverContent.inputTranscription.text;

        // Update or add user transcription message
        setTranscripts(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.role === 'user' && !lastMessage.isComplete) {
            // Update existing incomplete message
            return [...prev.slice(0, -1), {
              ...lastMessage,
              text: transcriptionBuffer.current.userText,
            }];
          } else {
            // Add new message
            return [...prev, {
              role: 'user',
              text: transcriptionBuffer.current.userText,
              timestamp: Date.now(),
              isComplete: false,
            }];
          }
        });
      }

      if (message.serverContent?.outputTranscription?.text) {
        transcriptionBuffer.current.modelText += message.serverContent.outputTranscription.text;

        // Update or add model transcription message
        setTranscripts(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.role === 'model' && !lastMessage.isComplete) {
            // Update existing incomplete message
            return [...prev.slice(0, -1), {
              ...lastMessage,
              text: transcriptionBuffer.current.modelText,
            }];
          } else {
            // Add new message
            return [...prev, {
              role: 'model',
              text: transcriptionBuffer.current.modelText,
              timestamp: Date.now(),
              isComplete: false,
            }];
          }
        });
      }

      // Mark messages as complete when turn is complete
      if (message.serverContent?.turnComplete) {
        setTranscripts(prev => {
          const updated = [...prev];
          const lastMessage = updated[updated.length - 1];
          if (lastMessage && !lastMessage.isComplete) {
            updated[updated.length - 1] = { ...lastMessage, isComplete: true };
          }
          return updated;
        });

        // Clear buffers
        transcriptionBuffer.current.userText = '';
        transcriptionBuffer.current.modelText = '';
      }

      if (message.serverContent?.modelTurn?.parts) {
        const hasNewAudio = message.serverContent.modelTurn.parts.some(
          (part: any) => part.inlineData?.mimeType?.startsWith("audio/"),
        );

        if (hasNewAudio) {
          // Extract session ID from message (sent by backend)
          const sessionId = message.responseSessionId;

          for (const part of message.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith("audio/")) {
              playAudio(part.inlineData.data, sessionId);
            }
          }
        }
      }

      if (message.setupComplete) {
        console.log("Gemini setup complete");
      }

      if (message.serverContent?.turnComplete) {
        console.log("AI turn complete");
      }
    });
  }, [onMessage, playAudio]);

  // Update ref whenever shouldSendAudio changes
  useEffect(() => {
    shouldSendAudioRef.current = shouldSendAudio;
  }, [shouldSendAudio]);

  const handleSendText = (text: string) => {
    if (isConnected && text.trim()) {
      sendTextMessage(text);

      // Add user message to transcripts immediately
      setTranscripts(prev => [...prev, {
        role: 'user',
        text: text,
        timestamp: Date.now(),
        isComplete: true,
      }]);
    }
  };

  const handleToggleRecording = async () => {
    if (isActive) {
      // Stop
      stopRecording();
      stopAudio();
      setIsActive(false);
    } else {
      // Start
      try {
        await startRecording(
          (audioData) => {
            sendAudioData(audioData);
          },
          () => shouldSendAudioRef.current, // Use ref to get current value
        );
        setIsActive(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
      }
    }
  };

  const handleVadStatusChange = (shouldSend: boolean) => {
    setShouldSendAudio(shouldSend);
  };

  const handleUserSpeakingChange = (isSpeaking: boolean) => {
    setVadStatus(prev => ({
      ...prev,
      userSpeaking: isSpeaking,
      lastSpeechTime: isSpeaking ? Date.now() : prev.lastSpeechTime,
    }));
  };

  return (
    <div className="h-screen bg-base-300 flex flex-col overflow-hidden">
      {/* Top Bar with Theme Selector */}
      <div className="navbar bg-base-200 border-b border-base-300 px-4 min-h-[3rem] h-12">
        <div className="flex-1">
          <span className="text-lg font-bold text-base-content">Habit AI</span>
        </div>
        <div className="flex-none">
          <ThemeSelector />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Main Section - Agent Content (4/5) */}
        <div className="flex-1 w-4/5 overflow-auto bg-base-100">
          <AgentView agent={agent} isConnected={isConnected} customEvents={customEvents} />
        </div>


        {/* Right Sidebar - Chat & Transcription (1/5) */}
        <RightSidebar
          transcripts={transcripts}
          isConnected={isConnected}
          isRecording={isRecording}
          onSendText={handleSendText}
          onToggleRecording={handleToggleRecording}
          vadStatus={vadStatus}
        />
      </div>

      {/* Hidden VAD Monitor - still needed for detection */}
      <div className="hidden">
        <VoiceActivityMonitor
          isActive={isActive}
          onShouldSendChange={handleVadStatusChange}
          onUserSpeakingChange={handleUserSpeakingChange}
        />
      </div>
    </div>
  );
}

export default App;
