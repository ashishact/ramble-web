/**
 * Main Page - Placeholder for new high-level UI
 *
 * TODO: Build the new core loop UI
 */

import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { VoiceRecorder } from './VoiceRecorder';

export function MainPage() {
  const navigate = useNavigate();

  const handleTranscript = async (text: string) => {
    console.log('[MainPage] Received transcript:', text);
    // TODO: Process through core loop
  };

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-100 border-b border-base-300">
        <div className="flex-1">
          <h1 className="text-xl font-bold px-4">Ramble v2</h1>
        </div>
        <div className="flex-none gap-2">
          <button
            className="btn btn-ghost btn-sm gap-2"
            onClick={() => navigate('/settings')}
          >
            <Icon icon="mdi:cog" className="w-5 h-5" />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 container mx-auto max-w-4xl p-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">
              <Icon icon="mdi:brain" className="w-6 h-6 text-primary" />
              Core Loop - Under Construction
            </h2>
            <p className="text-base-content/70">
              The new simplified architecture is being built. This will feature:
            </p>
            <ul className="list-disc list-inside text-sm text-base-content/60 space-y-1 mt-2">
              <li>Simple event loop: input → search → LLM → update → save</li>
              <li>Everything with temporality (when true, when reinforced)</li>
              <li>Plugin-based extraction system</li>
              <li>High-level knowledge view (entities, topics, memories, goals)</li>
            </ul>

            <div className="divider">Voice Input</div>

            <div className="flex justify-center">
              <VoiceRecorder
                onTranscript={handleTranscript}
                onMissingApiKey={() => navigate('/settings')}
              />
            </div>
          </div>
        </div>

        {/* Quick Stats Placeholder */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">Entities</div>
            <div className="stat-value text-primary">-</div>
          </div>
          <div className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">Topics</div>
            <div className="stat-value text-secondary">-</div>
          </div>
          <div className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">Memories</div>
            <div className="stat-value text-accent">-</div>
          </div>
          <div className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">Goals</div>
            <div className="stat-value text-info">-</div>
          </div>
        </div>
      </div>
    </div>
  );
}
