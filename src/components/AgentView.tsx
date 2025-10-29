import { AmigozView } from './amigoz/AmigozView';

interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

interface AgentViewProps {
  agent: string;
  isConnected: boolean;
  customEvents: { event: string; data: any } | null;
  transcripts: TranscriptMessage[];
  isRecording: boolean;
  onSendText: (text: string) => void;
  onToggleRecording: () => void;
  vadStatus?: {
    userSpeaking: boolean;
    lastSpeechTime: number;
    lastGeminiTime: number;
  };
}

export function AgentView({
  agent,
  isConnected,
  customEvents,
  transcripts,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus
}: AgentViewProps) {
  // Route to agent-specific views
  if (agent === 'amigoz') {
    return (
      <AmigozView
        isConnected={isConnected}
        customEvents={customEvents}
        transcripts={transcripts}
        isRecording={isRecording}
        onSendText={onSendText}
        onToggleRecording={onToggleRecording}
        vadStatus={vadStatus}
      />
    );
  }

  // Default view for other agents (health, planning, etc.)
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold text-white mb-4">Gemini Live Voice</h1>
      <p className="text-gray-400">
        {isConnected ? 'Connected and ready' : 'Connecting...'}
      </p>
    </div>
  );
}
