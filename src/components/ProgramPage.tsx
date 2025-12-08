/**
 * Program Page - Main UI for the RAMBLE System
 *
 * Displays claims, thought chains, goals, entities, patterns, and contradictions.
 * Includes voice recorder similar to ObserverPage.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgram } from '../program/hooks';
import { settingsHelpers } from '../stores/settingsStore';
import { useSTT } from '../services/stt/useSTT';
import type { STTConfig } from '../services/stt/types';

// ============================================================================
// Live Relative Time Component
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h ago`;
    }
    return `${days}d ago`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m ago`;
    }
    return `${hours}h ago`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s ago`;
  }

  return `${seconds}s ago`;
}

function LiveRelativeTime({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-xs opacity-60 font-mono">{formatRelativeTime(timestamp)}</span>
  );
}

// ============================================================================
// Claim Type Colors
// ============================================================================

const CLAIM_TYPE_COLORS: Record<string, string> = {
  factual: 'badge-info',
  belief: 'badge-secondary',
  intention: 'badge-accent',
  emotion: 'badge-error',
  goal: 'badge-success',
  value: 'badge-warning',
  concern: 'badge-error',
  commitment: 'badge-primary',
  decision: 'badge-info',
  learning: 'badge-success',
  memory_reference: 'badge-ghost',
  change_marker: 'badge-warning',
  preference: 'badge-accent',
  relationship: 'badge-secondary',
  habit: 'badge-primary',
  hypothetical: 'badge-ghost',
  causal: 'badge-info',
  question: 'badge-warning',
  self_perception: 'badge-accent',
};

// ============================================================================
// Stakes Colors
// ============================================================================

const STAKES_COLORS: Record<string, string> = {
  low: 'badge-ghost',
  medium: 'badge-info',
  high: 'badge-warning',
  existential: 'badge-error',
};

// ============================================================================
// Page Component
// ============================================================================

export function ProgramPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const claimsContainerRef = useRef<HTMLDivElement>(null);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [selectedClaimType, setSelectedClaimType] = useState<string | null>(null);

  const {
    isInitialized,
    isInitializing,
    error,
    state,
    claims,
    chains,
    goals,
    entities,
    patterns,
    contradictions,
    conversations,
    tasks,
    queueStatus,
    startSession,
    endSession,
    processText,
    refresh,
  } = useProgram();

  // STT config
  const sttConfig: STTConfig = useMemo(
    () => ({
      provider: 'groq-whisper',
      apiKey: settingsHelpers.getApiKey('groq') || '',
      chunkingStrategy: 'vad',
    }),
    []
  );

  // STT hook
  const {
    isConnected: sttConnected,
    isRecording,
    transcript,
    connect: connectSTT,
    disconnect: disconnectSTT,
    startRecording,
    stopRecording,
    clearTranscript,
  } = useSTT({ config: sttConfig });

  // Auto-start session if none active
  useEffect(() => {
    if (isInitialized && !state?.activeSession) {
      startSession();
    }
  }, [isInitialized, state?.activeSession, startSession]);

  // Update transcript display
  useEffect(() => {
    setCurrentTranscript(transcript);
  }, [transcript]);

  // Auto-scroll claims container
  useEffect(() => {
    if (claims.length > 0 && claimsContainerRef.current) {
      const container = claimsContainerRef.current;
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [claims.length]);

  // Connect STT on mount
  useEffect(() => {
    let mounted = true;

    const initSTT = async () => {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      if (groqApiKey && mounted) {
        try {
          await connectSTT();
        } catch (err) {
          console.error('[ProgramPage] STT connection error:', err);
        }
      }
    };

    initSTT();

    return () => {
      mounted = false;
      disconnectSTT();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle recording toggle
  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      // Save the transcript as text when recording stops
      if (transcript.trim()) {
        setIsProcessing(true);
        try {
          await processText(transcript.trim(), 'speech');
        } catch (err) {
          console.error('Failed to process voice text:', err);
        } finally {
          setIsProcessing(false);
        }
      }
      // Clear transcript after processing so next recording starts fresh
      clearTranscript();
      setCurrentTranscript('');
    } else {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      if (!groqApiKey) {
        alert('Please configure Groq API key in settings');
        navigate('/settings');
        return;
      }

      if (!sttConnected) {
        await connectSTT();
      }
      await startRecording();
    }
  }, [
    isRecording,
    transcript,
    sttConnected,
    connectSTT,
    startRecording,
    stopRecording,
    clearTranscript,
    navigate,
    processText,
  ]);

  // Handle text input submit
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputText.trim() || isProcessing) return;

      setIsProcessing(true);
      try {
        await processText(inputText.trim(), 'text');
        setInputText('');
      } catch (err) {
        console.error('Failed to process text:', err);
      } finally {
        setIsProcessing(false);
      }
    },
    [inputText, isProcessing, processText]
  );

  // Filter claims by type
  const filteredClaims = useMemo(() => {
    if (!selectedClaimType) return claims;
    return claims.filter((c) => c.claim_type === selectedClaimType);
  }, [claims, selectedClaimType]);

  // Count claims by type
  const claimTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const claim of claims) {
      counts[claim.claim_type] = (counts[claim.claim_type] || 0) + 1;
    }
    return counts;
  }, [claims]);

  // Loading state
  if (isInitializing) {
    return (
      <div className="h-screen bg-base-300 flex items-center justify-center">
        <div className="text-center">
          <span className="loading loading-spinner loading-lg"></span>
          <p className="mt-4 text-base-content/70">Initializing RAMBLE...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-screen bg-base-300 flex items-center justify-center">
        <div className="text-center">
          <div className="text-error text-2xl mb-4">Initialization Error</div>
          <p className="text-base-content/70 mb-4">{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-base-300 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="navbar bg-base-100 border-b border-base-300 px-4 min-h-0 h-14">
        <div className="flex-1">
          <h1 className="text-xl font-bold">RAMBLE</h1>
          <span className="text-xs text-base-content/50 ml-2 hidden sm:inline">
            Reasoning Architecture for Memory-Based Learning and Extraction
          </span>
        </div>
        <div className="flex-none gap-2">
          {state?.activeSession && (
            <div className="badge badge-success badge-sm gap-1">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
              Session Active
            </div>
          )}
          {isProcessing && (
            <div className="badge badge-info badge-sm gap-1">
              <span className="loading loading-spinner loading-xs"></span>
              Processing
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={refresh}>
            Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            Back
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            Settings
          </button>
        </div>
      </header>

      {/* Input Bar (top) */}
      <div className="bg-base-100 border-b border-base-300 p-4">
        <div className="flex gap-2 items-center max-w-4xl mx-auto">
          <button
            className={`btn ${isRecording ? 'btn-error animate-pulse' : 'btn-primary'} gap-2`}
            onClick={handleToggleRecording}
            disabled={isProcessing}
          >
            {isRecording ? (
              <>
                <span className="w-3 h-3 rounded-full bg-white"></span>
                Stop
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
                Record
              </>
            )}
          </button>
          <form onSubmit={handleSubmit} className="flex gap-2 flex-1">
            <input
              ref={inputRef}
              type="text"
              className="input input-bordered flex-1"
              placeholder="Type something to analyze..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!inputText.trim() || isProcessing}
            >
              {isProcessing ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : (
                'Send'
              )}
            </button>
          </form>
        </div>
        {(currentTranscript || isRecording) && (
          <div className="mt-2 max-w-4xl mx-auto">
            <div className="bg-base-200 p-2 rounded text-sm flex items-center gap-2">
              {isRecording && (
                <span className="loading loading-dots loading-xs text-error"></span>
              )}
              <span className="opacity-70">
                {currentTranscript || 'Listening...'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Conversations Panel */}
          <div className="card bg-base-100 shadow-sm xl:col-span-2">
            <div className="card-body p-4">
              <div className="flex justify-between items-center">
                <h2 className="card-title text-sm font-bold uppercase opacity-70">
                  Conversation ({conversations.length})
                </h2>
                <div className="flex gap-2 items-center">
                  {queueStatus.isRunning ? (
                    <span className="badge badge-success badge-sm">Queue Running</span>
                  ) : (
                    <span className="badge badge-warning badge-sm">Queue Stopped</span>
                  )}
                  {queueStatus.pendingTasks > 0 && (
                    <span className="badge badge-info badge-sm">
                      {queueStatus.pendingTasks} pending
                    </span>
                  )}
                  {queueStatus.activeTasks > 0 && (
                    <span className="badge badge-primary badge-sm">
                      {queueStatus.activeTasks} active
                    </span>
                  )}
                  {queueStatus.failedTasks > 0 && (
                    <span className="badge badge-error badge-sm">
                      {queueStatus.failedTasks} failed
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-y-auto max-h-48 space-y-2">
                {conversations.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No conversation yet. Start speaking or typing.
                  </p>
                ) : (
                  conversations
                    .slice()
                    .reverse()
                    .map((conv) => (
                      <div
                        key={conv.id}
                        className={`p-3 rounded-lg ${
                          conv.processed ? 'bg-base-200' : 'bg-warning/10 border border-warning/30'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <p className="text-sm">{conv.raw_text}</p>
                            <div className="flex gap-2 mt-1 text-xs text-base-content/50">
                              <span className="badge badge-xs badge-ghost">{conv.source}</span>
                              <span>
                                {conv.processed ? (
                                  <span className="text-success">✓ processed</span>
                                ) : (
                                  <span className="text-warning">⏳ processing</span>
                                )}
                              </span>
                            </div>
                          </div>
                          <span className="text-xs opacity-50 whitespace-nowrap">
                            {new Date(conv.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>

          {/* Statistics Card */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Overview</h2>
              <div className="grid grid-cols-2 gap-2">
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Claims</div>
                  <div className="stat-value text-2xl">{claims.length}</div>
                </div>
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Chains</div>
                  <div className="stat-value text-2xl">{chains.length}</div>
                </div>
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Goals</div>
                  <div className="stat-value text-2xl">{goals.length}</div>
                </div>
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Entities</div>
                  <div className="stat-value text-2xl">{entities.length}</div>
                </div>
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Patterns</div>
                  <div className="stat-value text-2xl">{patterns.length}</div>
                </div>
                <div className="stat bg-base-200 rounded-lg p-3">
                  <div className="stat-title text-xs">Contradictions</div>
                  <div className="stat-value text-2xl">{contradictions.length}</div>
                </div>
              </div>
              {/* Task Debug Info */}
              {tasks.length > 0 && (
                <div className="mt-2 text-xs">
                  <div className="font-bold opacity-70 mb-1">Recent Tasks:</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {tasks.slice(-5).reverse().map((task) => (
                      <div key={task.id} className="flex justify-between bg-base-200 p-1 rounded">
                        <span className="truncate flex-1">{task.task_type}</span>
                        <span className={`badge badge-xs ${
                          task.status === 'completed' ? 'badge-success' :
                          task.status === 'processing' ? 'badge-primary' :
                          task.status === 'failed' ? 'badge-error' :
                          'badge-ghost'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Claim Types Filter */}
          <div className="card bg-base-100 shadow-sm xl:col-span-2">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Claim Types
              </h2>
              <div className="flex flex-wrap gap-1">
                <button
                  className={`badge badge-lg cursor-pointer ${
                    !selectedClaimType ? 'badge-primary' : 'badge-ghost'
                  }`}
                  onClick={() => setSelectedClaimType(null)}
                >
                  All ({claims.length})
                </button>
                {Object.entries(claimTypeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <button
                      key={type}
                      className={`badge badge-lg cursor-pointer ${
                        selectedClaimType === type
                          ? CLAIM_TYPE_COLORS[type] || 'badge-primary'
                          : 'badge-ghost'
                      }`}
                      onClick={() =>
                        setSelectedClaimType(selectedClaimType === type ? null : type)
                      }
                    >
                      {type.replace('_', ' ')} ({count})
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Claims List */}
          <div className="card bg-base-100 shadow-sm xl:col-span-2 lg:row-span-2">
            <div className="card-body p-4">
              <div className="flex justify-between items-center">
                <h2 className="card-title text-sm font-bold uppercase opacity-70">
                  Claims ({filteredClaims.length})
                </h2>
                {isProcessing && (
                  <div className="flex items-center gap-2 text-info">
                    <span className="loading loading-spinner loading-xs"></span>
                    <span className="text-xs">Extracting...</span>
                  </div>
                )}
              </div>
              <div
                ref={claimsContainerRef}
                className="overflow-y-auto max-h-[500px] space-y-2"
              >
                {filteredClaims.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-8">
                    {claims.length === 0
                      ? 'No claims yet. Record or type something above to start.'
                      : 'No claims matching this filter.'}
                  </p>
                ) : (
                  filteredClaims
                    .slice()
                    .reverse()
                    .map((claim, index) => {
                      const isLast = index === 0;
                      return (
                        <div
                          key={claim.id}
                          className="p-3 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{claim.statement}</p>
                              <div className="flex flex-wrap gap-1 mt-2">
                                <span
                                  className={`badge badge-xs ${
                                    CLAIM_TYPE_COLORS[claim.claim_type] || 'badge-ghost'
                                  }`}
                                >
                                  {claim.claim_type.replace('_', ' ')}
                                </span>
                                <span className="badge badge-xs badge-outline">
                                  {claim.subject}
                                </span>
                                <span
                                  className={`badge badge-xs ${
                                    STAKES_COLORS[claim.stakes] || 'badge-ghost'
                                  }`}
                                >
                                  {claim.stakes} stakes
                                </span>
                                <span className="badge badge-xs badge-ghost">
                                  {Math.round(claim.current_confidence * 100)}% conf
                                </span>
                                {claim.emotional_valence !== 0 && (
                                  <span
                                    className={`badge badge-xs ${
                                      claim.emotional_valence > 0
                                        ? 'badge-success'
                                        : 'badge-error'
                                    }`}
                                  >
                                    {claim.emotional_valence > 0 ? '+' : ''}
                                    {claim.emotional_valence.toFixed(1)} val
                                  </span>
                                )}
                                {claim.emotional_intensity > 0.5 && (
                                  <span className="badge badge-xs badge-warning">
                                    {Math.round(claim.emotional_intensity * 100)}% intense
                                  </span>
                                )}
                              </div>
                            </div>
                            {isLast ? (
                              <LiveRelativeTime timestamp={claim.created_at} />
                            ) : (
                              <span className="text-xs opacity-50">
                                {formatRelativeTime(claim.created_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>

          {/* Thought Chains */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Thought Chains ({chains.length})
              </h2>
              <div className="overflow-y-auto max-h-64 space-y-2">
                {chains.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No chains yet.
                  </p>
                ) : (
                  chains.map((chain) => (
                    <div key={chain.id} className="p-3 bg-base-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{chain.topic}</span>
                        <span
                          className={`badge badge-xs ${
                            chain.state === 'active'
                              ? 'badge-success'
                              : chain.state === 'dormant'
                              ? 'badge-warning'
                              : 'badge-ghost'
                          }`}
                        >
                          {chain.state}
                        </span>
                      </div>
                      <div className="text-xs text-base-content/50 mt-1">
                        Last active: {formatRelativeTime(chain.last_extended)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Goals */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Goals ({goals.length})
              </h2>
              <div className="overflow-y-auto max-h-64 space-y-2">
                {goals.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No goals detected yet.
                  </p>
                ) : (
                  goals.map((goal) => (
                    <div key={goal.id} className="p-3 bg-base-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm flex-1">{goal.statement}</span>
                        <span
                          className={`badge badge-xs ${
                            goal.status === 'active'
                              ? 'badge-success'
                              : goal.status === 'achieved'
                              ? 'badge-primary'
                              : goal.status === 'blocked'
                              ? 'badge-error'
                              : 'badge-ghost'
                          }`}
                        >
                          {goal.status}
                        </span>
                      </div>
                      <div className="mt-2">
                        <progress
                          className="progress progress-primary w-full h-2"
                          value={goal.progress_value}
                          max="100"
                        ></progress>
                        <div className="flex justify-between text-xs text-base-content/50 mt-1">
                          <span>{goal.progress_value}%</span>
                          <span className="badge badge-xs badge-ghost">{goal.timeframe}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Entities */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Entities ({entities.length})
              </h2>
              <div className="overflow-y-auto max-h-64 space-y-1">
                {entities.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No entities detected yet.
                  </p>
                ) : (
                  entities
                    .slice()
                    .sort((a, b) => b.mention_count - a.mention_count)
                    .map((entity) => (
                      <div
                        key={entity.id}
                        className="flex justify-between items-center p-2 bg-base-200 rounded"
                      >
                        <span className="text-sm">
                          <span className="badge badge-xs badge-ghost mr-2">
                            {entity.entity_type}
                          </span>
                          {entity.canonical_name}
                        </span>
                        <span className="badge badge-sm">{entity.mention_count}x</span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>

          {/* Patterns */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Detected Patterns ({patterns.length})
              </h2>
              <div className="overflow-y-auto max-h-64 space-y-2">
                {patterns.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No patterns detected yet.
                  </p>
                ) : (
                  patterns.map((pattern) => (
                    <div key={pattern.id} className="p-3 bg-base-200 rounded-lg">
                      <div className="text-sm">{pattern.description}</div>
                      <div className="flex gap-2 mt-2">
                        <span className="badge badge-xs badge-ghost">
                          {pattern.pattern_type}
                        </span>
                        <span className="badge badge-xs badge-outline">
                          {pattern.occurrence_count}x
                        </span>
                        <span className="badge badge-xs">
                          {Math.round(pattern.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Contradictions */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Contradictions ({contradictions.length})
              </h2>
              <div className="overflow-y-auto max-h-64 space-y-2">
                {contradictions.length === 0 ? (
                  <p className="text-base-content/50 text-sm text-center py-4">
                    No contradictions detected.
                  </p>
                ) : (
                  contradictions.map((contradiction) => (
                    <div
                      key={contradiction.id}
                      className="p-3 bg-error/10 rounded-lg border border-error/20"
                    >
                      <div className="text-sm">
                        <span className="font-medium">
                          {contradiction.contradiction_type}
                        </span>{' '}
                        contradiction
                      </div>
                      {contradiction.resolution_notes && (
                        <p className="text-xs text-base-content/70 mt-1">
                          {contradiction.resolution_notes}
                        </p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <span
                          className={`badge badge-xs ${
                            contradiction.resolved ? 'badge-success' : 'badge-warning'
                          }`}
                        >
                          {contradiction.resolved ? 'Resolved' : 'Unresolved'}
                        </span>
                        {contradiction.resolution_type && (
                          <span className="badge badge-xs badge-ghost">
                            {contradiction.resolution_type}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer with session controls */}
      <footer className="bg-base-100 border-t border-base-300 px-4 py-2">
        <div className="flex items-center justify-between text-sm">
          <div className="text-base-content/50 flex items-center gap-4">
            {state?.activeSession ? (
              <>
                <span>Session: {state.activeSession.id.slice(0, 8)}...</span>
                <span>Started: {new Date(state.activeSession.started_at).toLocaleTimeString()}</span>
              </>
            ) : (
              <>No active session</>
            )}
            {sttConnected && (
              <span className="badge badge-xs badge-success">STT Connected</span>
            )}
          </div>
          <div className="flex gap-2">
            {state?.activeSession ? (
              <button className="btn btn-sm btn-ghost" onClick={endSession}>
                End Session
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={startSession}>
                Start Session
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
