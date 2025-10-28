import { AmigozView } from './amigoz/AmigozView';

interface AgentViewProps {
  agent: string;
  isConnected: boolean;
  customEvents: { event: string; data: any } | null;
}

export function AgentView({ agent, isConnected, customEvents }: AgentViewProps) {
  // Route to agent-specific views
  if (agent === 'amigoz') {
    return <AmigozView isConnected={isConnected} customEvents={customEvents} />;
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
