/**
 * Main Page - Core Loop UI
 *
 * Simple interface for the core loop:
 * - Voice/text input
 * - Real-time stats
 * - Browseable knowledge base with temporality
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { VoiceRecorder } from './VoiceRecorder';
import { ConversationList } from './ConversationList';
import { EntityManager } from './EntityManager';
import { WorkingMemory } from './WorkingMemory';
import { useKernel } from '../../program/hooks';
import { formatRelativeTime } from '../../program/utils';
import { entityStore, topicStore, memoryStore, goalStore, conversationStore } from '../../db/stores';
import type { ProcessingResult } from '../../program';
import type Entity from '../../db/models/Entity';
import type Topic from '../../db/models/Topic';
import type Memory from '../../db/models/Memory';
import type Goal from '../../db/models/Goal';
import type Conversation from '../../db/models/Conversation';

interface Stats {
  entities: number;
  topics: number;
  memories: number;
  goals: number;
}

type TabType = 'entities' | 'topics' | 'memories' | 'goals';

export function MainPage() {
  const navigate = useNavigate();
  const { isInitialized, isProcessing, currentSession, submitInput } = useKernel();

  const [stats, setStats] = useState<Stats>({ entities: 0, topics: 0, memories: 0, goals: 0 });
  const [lastResult, setLastResult] = useState<ProcessingResult | null>(null);
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Browse state (all items for browsing panels)
  const [activeTab, setActiveTab] = useState<TabType | null>(null);
  const [allEntities, setAllEntities] = useState<Entity[]>([]);
  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [allMemories, setAllMemories] = useState<Memory[]>([]);
  const [allGoals, setAllGoals] = useState<Goal[]>([]);

  // Conversation sidebar state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConversations, setShowConversations] = useState(true);

  // Entity Manager modal
  const [showEntityManager, setShowEntityManager] = useState(false);

  // WorkingMemory refresh trigger - increment to force refresh
  const [wmRefreshTrigger, setWmRefreshTrigger] = useState(0);

  // Load stats and conversations on mount and after processing
  // WorkingMemory fetches its own data using same queries as contextBuilder
  // Browse panels get all items for full visibility
  const loadStats = useCallback(async () => {
    const [
      entities,
      topics,
      memories,
      goals,
      recentConversations,
    ] = await Promise.all([
      entityStore.getAll(),
      topicStore.getAll(),
      memoryStore.getMostImportant(100), // More for browsing
      goalStore.getActive(),
      conversationStore.getRecent(100),
    ]);

    setStats({
      entities: entities.length,
      topics: topics.length,
      memories: memories.length,
      goals: goals.length,
    });

    // For browsing panels - all items
    setAllEntities(entities);
    setAllTopics(topics);
    setAllMemories(memories);
    setAllGoals(goals);
    setConversations(recentConversations);

    // Trigger WorkingMemory to refresh its data
    setWmRefreshTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      loadStats();
    }
  }, [isInitialized, loadStats]);

  // Handle voice transcript
  const handleTranscript = async (text: string) => {
    setError(null);
    try {
      const result = await submitInput(text, 'speech');
      if (result.processingResult) {
        setLastResult(result.processingResult);
      }
      if (result.error) {
        setError(result.error);
      }
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // Handle text submit
  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;

    setError(null);
    try {
      const result = await submitInput(textInput.trim(), 'text');
      if (result.processingResult) {
        setLastResult(result.processingResult);
      }
      if (result.error) {
        setError(result.error);
      }
      setTextInput('');
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <div className="h-screen bg-base-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="navbar bg-base-100 border-b border-base-300 shrink-0">
        <div className="flex-1">
          <h1 className="text-xl font-bold px-4">Ramble v2</h1>
          {currentSession && (
            <span className="badge badge-ghost text-xs">
              Session: {currentSession.id.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex-none gap-2">
          {!showConversations && (
            <button
              className="btn btn-ghost btn-sm gap-2"
              onClick={() => setShowConversations(true)}
            >
              <Icon icon="mdi:message-text" className="w-5 h-5" />
              Show Chat
            </button>
          )}
          {isProcessing && (
            <span className="loading loading-spinner loading-sm text-primary"></span>
          )}
          <button
            className="btn btn-ghost btn-sm gap-2"
            onClick={() => navigate('/settings')}
          >
            <Icon icon="mdi:cog" className="w-5 h-5" />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Conversations */}
        {showConversations && (
          <ConversationList
            conversations={conversations}
            onClose={() => setShowConversations(false)}
          />
        )}

        {/* Right Panel - Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Working Memory - LLM Context (always visible at top) */}
        <WorkingMemory refreshTrigger={wmRefreshTrigger} />

        {/* Input Section */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body py-4">
            {/* Voice Input */}
            <div className="flex justify-center">
              <VoiceRecorder
                onTranscript={handleTranscript}
                onMissingApiKey={() => navigate('/settings')}
                disabled={!isInitialized || isProcessing}
              />
            </div>

            <div className="divider my-2">or type</div>

            {/* Text Input */}
            <form onSubmit={handleTextSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Type something..."
                className="input input-bordered flex-1"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                disabled={!isInitialized || isProcessing}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!isInitialized || isProcessing || !textInput.trim()}
              >
                {isProcessing ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  <Icon icon="mdi:send" className="w-5 h-5" />
                )}
              </button>
            </form>

            {/* Error */}
            {error && (
              <div className="alert alert-error mt-2">
                <Icon icon="mdi:alert-circle" className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Stats - Clickable to toggle browse panels */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button
            className={`stat bg-base-100 rounded-box shadow cursor-pointer hover:bg-base-200 transition-colors ${activeTab === 'entities' ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setActiveTab(activeTab === 'entities' ? null : 'entities')}
          >
            <div className="stat-figure text-primary">
              <Icon icon="mdi:account-group" className="w-8 h-8" />
            </div>
            <div className="stat-title">Entities</div>
            <div className="stat-value text-primary">{stats.entities}</div>
          </button>
          <button
            className={`stat bg-base-100 rounded-box shadow cursor-pointer hover:bg-base-200 transition-colors ${activeTab === 'topics' ? 'ring-2 ring-secondary' : ''}`}
            onClick={() => setActiveTab(activeTab === 'topics' ? null : 'topics')}
          >
            <div className="stat-figure text-secondary">
              <Icon icon="mdi:tag-multiple" className="w-8 h-8" />
            </div>
            <div className="stat-title">Topics</div>
            <div className="stat-value text-secondary">{stats.topics}</div>
          </button>
          <button
            className={`stat bg-base-100 rounded-box shadow cursor-pointer hover:bg-base-200 transition-colors ${activeTab === 'memories' ? 'ring-2 ring-accent' : ''}`}
            onClick={() => setActiveTab(activeTab === 'memories' ? null : 'memories')}
          >
            <div className="stat-figure text-accent">
              <Icon icon="mdi:brain" className="w-8 h-8" />
            </div>
            <div className="stat-title">Memories</div>
            <div className="stat-value text-accent">{stats.memories}</div>
          </button>
          <button
            className={`stat bg-base-100 rounded-box shadow cursor-pointer hover:bg-base-200 transition-colors ${activeTab === 'goals' ? 'ring-2 ring-info' : ''}`}
            onClick={() => setActiveTab(activeTab === 'goals' ? null : 'goals')}
          >
            <div className="stat-figure text-info">
              <Icon icon="mdi:target" className="w-8 h-8" />
            </div>
            <div className="stat-title">Goals</div>
            <div className="stat-value text-info">{stats.goals}</div>
          </button>
        </div>

        {/* Last Result */}
        {lastResult && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">
                <Icon icon="mdi:check-circle" className="w-6 h-6 text-success" />
                Last Extraction
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Entities */}
                {lastResult.entities.length > 0 && (
                  <div>
                    <h3 className="font-medium text-sm opacity-60 mb-2">Entities</h3>
                    <div className="flex flex-wrap gap-2">
                      {lastResult.entities.map((e) => (
                        <span
                          key={e.id}
                          className={`badge ${e.isNew ? 'badge-primary' : 'badge-ghost'}`}
                        >
                          {e.name} ({e.type})
                          {e.isNew && <span className="ml-1 text-xs">NEW</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Topics */}
                {lastResult.topics.length > 0 && (
                  <div>
                    <h3 className="font-medium text-sm opacity-60 mb-2">Topics</h3>
                    <div className="flex flex-wrap gap-2">
                      {lastResult.topics.map((t) => (
                        <span
                          key={t.id}
                          className={`badge ${t.isNew ? 'badge-secondary' : 'badge-ghost'}`}
                        >
                          {t.name}
                          {t.isNew && <span className="ml-1 text-xs">NEW</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Memories */}
                {lastResult.memories.length > 0 && (
                  <div className="md:col-span-2">
                    <h3 className="font-medium text-sm opacity-60 mb-2">New Memories</h3>
                    <ul className="space-y-1">
                      {lastResult.memories.map((m) => (
                        <li key={m.id} className="text-sm flex items-start gap-2">
                          <span className="badge badge-xs badge-accent mt-1">{m.type}</span>
                          <span>{m.content}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Browse Panels */}
        {activeTab === 'entities' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">
                  <Icon icon="mdi:account-group" className="w-6 h-6 text-primary" />
                  Entities ({allEntities.length})
                </h2>
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary btn-sm gap-1"
                    onClick={() => setShowEntityManager(true)}
                  >
                    <Icon icon="mdi:cog" className="w-4 h-4" />
                    Manage
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>
                    <Icon icon="mdi:close" className="w-5 h-5" />
                  </button>
                </div>
              </div>
              {allEntities.length === 0 ? (
                <p className="text-base-content/60">No entities yet. Start speaking or typing to build your knowledge base.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Mentions</th>
                        <th>First Seen</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allEntities.map((e) => (
                        <tr key={e.id} className="hover">
                          <td className="font-medium">{e.name}</td>
                          <td><span className="badge badge-ghost badge-sm">{e.type}</span></td>
                          <td>{e.mentionCount}</td>
                          <td className="text-xs opacity-60">{formatRelativeTime(e.firstMentioned)}</td>
                          <td className="text-xs opacity-60">{formatRelativeTime(e.lastMentioned)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'topics' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">
                  <Icon icon="mdi:tag-multiple" className="w-6 h-6 text-secondary" />
                  Topics ({allTopics.length})
                </h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>
                  <Icon icon="mdi:close" className="w-5 h-5" />
                </button>
              </div>
              {allTopics.length === 0 ? (
                <p className="text-base-content/60">No topics yet. Topics are automatically extracted from your conversations.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Category</th>
                        <th>Mentions</th>
                        <th>First Seen</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTopics.map((t) => (
                        <tr key={t.id} className="hover">
                          <td className="font-medium">{t.name}</td>
                          <td><span className="badge badge-ghost badge-sm">{t.category || 'general'}</span></td>
                          <td>{t.mentionCount}</td>
                          <td className="text-xs opacity-60">{formatRelativeTime(t.firstMentioned)}</td>
                          <td className="text-xs opacity-60">{formatRelativeTime(t.lastMentioned)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'memories' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">
                  <Icon icon="mdi:brain" className="w-6 h-6 text-accent" />
                  Memories ({allMemories.length})
                </h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>
                  <Icon icon="mdi:close" className="w-5 h-5" />
                </button>
              </div>
              {allMemories.length === 0 ? (
                <p className="text-base-content/60">No memories yet. Facts, beliefs, and preferences will appear here.</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {allMemories.map((m) => (
                    <div key={m.id} className="p-3 bg-base-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="badge badge-accent badge-sm mt-0.5">{m.type}</span>
                        <div className="flex-1">
                          <p className="text-sm">{m.content}</p>
                          <div className="flex gap-4 mt-2 text-xs opacity-60">
                            <span>Confidence: {Math.round(m.confidence * 100)}%</span>
                            <span>Importance: {Math.round(m.importance * 100)}%</span>
                            <span>Reinforced {m.reinforcementCount}x</span>
                            <span>{formatRelativeTime(m.lastReinforced)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'goals' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">
                  <Icon icon="mdi:target" className="w-6 h-6 text-info" />
                  Goals ({allGoals.length})
                </h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab(null)}>
                  <Icon icon="mdi:close" className="w-5 h-5" />
                </button>
              </div>
              {allGoals.length === 0 ? (
                <p className="text-base-content/60">No goals yet. Goals and intentions will be tracked here.</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {allGoals.map((g) => (
                    <div key={g.id} className="p-3 bg-base-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{g.statement}</span>
                        <span className={`badge ${
                          g.status === 'achieved' ? 'badge-success' :
                          g.status === 'blocked' ? 'badge-error' :
                          g.status === 'abandoned' ? 'badge-ghost' :
                          'badge-info'
                        }`}>
                          {g.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <progress
                          className="progress progress-info flex-1"
                          value={g.progress}
                          max="100"
                        ></progress>
                        <span className="text-xs font-mono">{g.progress}%</span>
                      </div>
                      <div className="flex gap-4 text-xs opacity-60">
                        <span>Type: {g.type}</span>
                        <span>First: {formatRelativeTime(g.firstExpressed)}</span>
                        <span>Last: {formatRelativeTime(g.lastReferenced)}</span>
                        {g.achievedAt && <span>Achieved: {formatRelativeTime(g.achievedAt)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Initialization */}
        {!isInitialized && (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        )}
        </div>
      </div>

      {/* Entity Manager Modal */}
      {showEntityManager && (
        <EntityManager
          onClose={() => {
            setShowEntityManager(false);
            loadStats(); // Refresh data after closing
          }}
        />
      )}
    </div>
  );
}
