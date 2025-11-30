import { Icon } from '@iconify/react';
import { AmigozView } from './amigoz/AmigozView';
import type { ObserverMessage } from '../services/observerAgentAI';

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
  observerMessages?: ObserverMessage[];
  observerStatus?: { status: string; description: string };
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

export function AgentView({
  agent,
  isConnected,
  customEvents,
  transcripts,
  observerMessages,
  observerStatus,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus,
  onOpenSettings
}: AgentViewProps) {
  // Route to agent-specific views
  if (agent === 'amigoz') {
    return (
      <AmigozView
        isConnected={isConnected}
        customEvents={customEvents}
        transcripts={transcripts}
        observerMessages={observerMessages}
        observerStatus={observerStatus}
        isRecording={isRecording}
        onSendText={onSendText}
        onToggleRecording={onToggleRecording}
        vadStatus={vadStatus}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  // Default view for other agents (health, planning, etc.)
  return (
    <div className="flex-1 flex flex-col items-center justify-center relative">
      {/* Settings button */}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="absolute top-4 right-4 btn btn-ghost btn-sm gap-2"
        >
          <Icon icon="mdi:cog" className="w-5 h-5" />
          Settings
        </button>
      )}

      <h1 className="text-4xl font-bold text-base-content mb-4">Voice Agent</h1>
      <p className="text-base-content/60">
        {isConnected ? 'Connected and ready' : 'Connecting...'}
      </p>
    </div>
  );
}
