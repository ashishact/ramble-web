/**
 * Program Page - Main UI for the RAMBLE System
 *
 * Enhanced UI with tabbed panels, detailed views, and better usability.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getKernel } from '../program';
import { useNavigate } from 'react-router-dom';
import { useProgram } from '../program/hooks';
import { settingsHelpers } from '../stores/settingsStore';
import { useSTT } from '../services/stt/useSTT';
import type { STTConfig } from '../services/stt/types';
import type { Claim, Entity, Goal, Pattern, Contradiction, Correction } from '../program';
import { MemoryTab } from './program/MemoryTab';
import { ExtractorsObserversTab } from './program/ExtractorsObserversTab';
import { ClaimDebugPanel } from './program/ClaimDebugPanel';
import { Icon } from '@iconify/react';

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

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function LiveRelativeTime({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-xs opacity-60 font-mono">{formatRelativeTime(timestamp)}</span>
  );
}

// ============================================================================
// Color Maps
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

const STAKES_COLORS: Record<string, string> = {
  low: 'badge-ghost',
  medium: 'badge-info',
  high: 'badge-warning',
  existential: 'badge-error',
};

const ENTITY_TYPE_ICONS: Record<string, string> = {
  person: '👤',
  organization: '🏢',
  product: '📦',
  place: '📍',
  project: '📁',
  role: '🎭',
  event: '📅',
  concept: '💡',
};

// ============================================================================
// Sub-Components
// ============================================================================

function ClaimCard({ claim, isLatest }: { claim: Claim; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [hasSourceTracking, setHasSourceTracking] = useState(false);

  // Check if source tracking exists for this claim
  useEffect(() => {
    async function checkSourceTracking() {
      try {
        const kernel = getKernel();
        const store = kernel.getStore();
        const tracking = await store.sourceTracking.getByClaimId(claim.id);
        setHasSourceTracking(!!tracking);
      } catch (error) {
        // Kernel not initialized yet or error fetching
        setHasSourceTracking(false);
      }
    }
    checkSourceTracking();
  }, [claim.id]);

  return (
    <>
      <div
        className={`p-3 bg-base-200 rounded-lg hover:bg-base-300 transition-all cursor-pointer ${
          isLatest ? 'ring-2 ring-primary/30' : ''
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium leading-relaxed">{claim.statement}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <span className={`badge badge-xs ${CLAIM_TYPE_COLORS[claim.claimType] || 'badge-ghost'}`}>
                {claim.claimType.replace('_', ' ')}
              </span>
              <span className={`badge badge-xs ${STAKES_COLORS[claim.stakes] || 'badge-ghost'}`}>
                {claim.stakes}
              </span>
              <span className="badge badge-xs badge-outline">{claim.subject}</span>
              {hasSourceTracking && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDebug(true);
                  }}
                  className="badge badge-xs badge-warning gap-1 hover:badge-error cursor-pointer"
                  title="View source tracking (debug)"
                >
                  <Icon icon="mdi:bug" className="w-3 h-3" />
                  debug
                </button>
              )}
            </div>
          </div>
          <div className="text-right flex flex-col items-end gap-1">
            {isLatest ? (
              <LiveRelativeTime timestamp={claim.createdAt} />
            ) : (
              <span className="text-xs opacity-50">{formatRelativeTime(claim.createdAt)}</span>
            )}
            <span className="text-xs opacity-50">{Math.round(claim.currentConfidence * 100)}%</span>
          </div>
        </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-base-300 text-xs space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="opacity-50">Temporality:</span>{' '}
              <span className="font-medium">{claim.temporality.replace('_', ' ')}</span>
            </div>
            <div>
              <span className="opacity-50">Source:</span>{' '}
              <span className="font-medium">{claim.sourceType}</span>
            </div>
            <div>
              <span className="opacity-50">Abstraction:</span>{' '}
              <span className="font-medium">{claim.abstraction}</span>
            </div>
            <div>
              <span className="opacity-50">State:</span>{' '}
              <span className="font-medium">{claim.state}</span>
            </div>
          </div>
          {(claim.emotionalValence !== 0 || claim.emotionalIntensity > 0) && (
            <div className="flex gap-4">
              <div>
                <span className="opacity-50">Valence:</span>{' '}
                <span className={claim.emotionalValence > 0 ? 'text-success' : claim.emotionalValence < 0 ? 'text-error' : ''}>
                  {claim.emotionalValence > 0 ? '+' : ''}{claim.emotionalValence.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="opacity-50">Intensity:</span>{' '}
                <span className={claim.emotionalIntensity > 0.7 ? 'text-warning font-bold' : ''}>
                  {Math.round(claim.emotionalIntensity * 100)}%
                </span>
              </div>
            </div>
          )}
          {claim.confirmationCount > 0 && (
            <div>
              <span className="opacity-50">Confirmed:</span>{' '}
              <span className="font-medium">{claim.confirmationCount}x</span>
            </div>
          )}
        </div>
      )}
    </div>

      {/* Debug Panel Modal */}
      {showDebug && (
        <ClaimDebugPanel claim={claim} onClose={() => setShowDebug(false)} />
      )}
    </>
  );
}

function EntityCard({ entity }: { entity: Entity }) {
  return (
    <div className="p-2 bg-base-200 rounded-lg hover:bg-base-300 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-lg">{ENTITY_TYPE_ICONS[entity.entityType] || '❓'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{entity.canonicalName}</div>
          <div className="text-xs opacity-50">{entity.entityType}</div>
        </div>
        <div className="badge badge-sm badge-primary">{entity.mentionCount}x</div>
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const statusColors: Record<string, string> = {
    active: 'text-success',
    achieved: 'text-primary',
    blocked: 'text-error',
    abandoned: 'text-base-content/50',
    deferred: 'text-warning',
  };

  return (
    <div className="p-3 bg-base-200 rounded-lg">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-medium flex-1">{goal.statement}</span>
        <span className={`text-xs font-bold uppercase ${statusColors[goal.status] || ''}`}>
          {goal.status}
        </span>
      </div>
      <progress
        className={`progress w-full h-2 ${
          goal.status === 'achieved' ? 'progress-success' :
          goal.status === 'blocked' ? 'progress-error' :
          'progress-primary'
        }`}
        value={goal.progressValue}
        max="100"
      />
      <div className="flex justify-between items-center mt-1 text-xs opacity-60">
        <span>{goal.progressValue}% complete</span>
        <span className="badge badge-xs badge-ghost">{goal.timeframe}</span>
      </div>
      {goal.goalType && (
        <div className="mt-2 text-xs opacity-50">
          Type: {goal.goalType} | Priority: {goal.priority}
        </div>
      )}
    </div>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  return (
    <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
      <div className="text-sm font-medium">{pattern.description}</div>
      <div className="flex flex-wrap gap-2 mt-2">
        <span className="badge badge-xs badge-primary">{pattern.patternType}</span>
        <span className="badge badge-xs badge-outline">{pattern.occurrenceCount} occurrences</span>
        <span className="badge badge-xs">{Math.round(pattern.confidence * 100)}% confidence</span>
      </div>
    </div>
  );
}

function ContradictionCard({
  contradiction,
  claimA,
  claimB
}: {
  contradiction: Contradiction;
  claimA: Claim | null;
  claimB: Claim | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        contradiction.resolved
          ? 'bg-success/10 border-success/20 hover:bg-success/15'
          : 'bg-error/10 border-error/20 hover:bg-error/15'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{contradiction.resolved ? '✓' : '⚠️'}</span>
          <span className="text-sm font-medium capitalize">
            {contradiction.contradictionType.replace('_', ' ')} contradiction
          </span>
        </div>
        <span className={`badge badge-xs ${contradiction.resolved ? 'badge-success' : 'badge-error'}`}>
          {contradiction.resolved ? 'Resolved' : 'Unresolved'}
        </span>
      </div>

      {/* Show the two conflicting claims */}
      <div className="space-y-2 mb-2">
        <div className="bg-base-100/50 rounded p-2">
          <div className="text-xs opacity-50 mb-1">Claim A:</div>
          <p className="text-sm">
            {claimA ? claimA.statement : <span className="opacity-50 italic">Claim not found</span>}
          </p>
          {claimA && (
            <div className="flex gap-1 mt-1">
              <span className={`badge badge-xs ${CLAIM_TYPE_COLORS[claimA.claimType] || 'badge-ghost'}`}>
                {claimA.claimType.replace('_', ' ')}
              </span>
              <span className="badge badge-xs badge-outline">{claimA.subject}</span>
            </div>
          )}
        </div>
        <div className="flex justify-center">
          <span className="text-error text-xs font-bold">VS</span>
        </div>
        <div className="bg-base-100/50 rounded p-2">
          <div className="text-xs opacity-50 mb-1">Claim B:</div>
          <p className="text-sm">
            {claimB ? claimB.statement : <span className="opacity-50 italic">Claim not found</span>}
          </p>
          {claimB && (
            <div className="flex gap-1 mt-1">
              <span className={`badge badge-xs ${CLAIM_TYPE_COLORS[claimB.claimType] || 'badge-ghost'}`}>
                {claimB.claimType.replace('_', ' ')}
              </span>
              <span className="badge badge-xs badge-outline">{claimB.subject}</span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-base-300/50 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="opacity-50">Detected:</span>
            <span>{formatRelativeTime(contradiction.detectedAt)}</span>
          </div>
          {contradiction.resolved && contradiction.resolvedAt && (
            <div className="flex justify-between">
              <span className="opacity-50">Resolved:</span>
              <span>{formatRelativeTime(contradiction.resolvedAt)}</span>
            </div>
          )}
          {contradiction.resolutionType && (
            <div className="flex justify-between">
              <span className="opacity-50">Resolution type:</span>
              <span className="font-medium">{contradiction.resolutionType}</span>
            </div>
          )}
          {contradiction.resolutionNotes && (
            <div>
              <span className="opacity-50">Notes:</span>
              <p className="mt-1 bg-base-100/50 p-2 rounded">{contradiction.resolutionNotes}</p>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-center opacity-40 mt-2">
        {expanded ? '▲ Click to collapse' : '▼ Click for details'}
      </div>
    </div>
  );
}

function CorrectionCard({ correction, onRemove }: { correction: Correction; onRemove: (id: string) => Promise<boolean> }) {
  return (
    <div className="p-3 bg-base-200 rounded-lg flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-error line-through opacity-70">{correction.wrongText}</span>
          <span className="text-base-content/50">→</span>
          <span className="text-success font-medium">{correction.correctText}</span>
        </div>
        <div className="flex gap-2 mt-1 text-xs opacity-50">
          <span>Used {correction.usageCount}x</span>
          <span>•</span>
          <span>Added {formatRelativeTime(correction.createdAt)}</span>
        </div>
      </div>
      <button
        className="btn btn-ghost btn-xs btn-square text-error"
        onClick={() => onRemove(correction.id)}
        title="Remove correction"
      >
        ✕
      </button>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

type TabType = 'claims' | 'entities' | 'goals' | 'patterns' | 'corrections' | 'insights' | 'memory' | 'extractors';

export function ProgramPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const claimsContainerRef = useRef<HTMLDivElement>(null);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [selectedClaimType, setSelectedClaimType] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('claims');
  const [showConversations, setShowConversations] = useState(true);
  const [showRawText, setShowRawText] = useState(true); // Toggle between raw and sanitized text
  const [conversationsDisplayLimit, setConversationsDisplayLimit] = useState(20); // Lazy load limit
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    type: string;
    id: string;
    field: string;
    value: string;
    context: string;
  }>>([]);
  const [replaceResult, setReplaceResult] = useState<{
    conversationsUpdated: number;
    claimsUpdated: number;
    entitiesUpdated: number;
    goalsUpdated: number;
    totalReplacements: number;
  } | null>(null);
  const [addAsCorrection, setAddAsCorrection] = useState(true);

  const {
    isInitialized,
    isInitializing,
    error,
    state,
    claims,
    claimCount,
    goals,
    entities,
    patterns,
    contradictions,
    conversations,
    tasks,
    corrections,
    queueStatus,
    workingMemory,
    longTermMemory,
    topOfMind,
    memoryStats,
    extractors,
    observers,
    observerStats,
    startSession,
    endSession,
    processText,
    addCorrection,
    removeCorrection,
    searchText,
    replaceText,
    recordMemoryAccess,
    toggleExtractor,
    toggleObserver,
    loadMoreClaims,
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
    stopRecordingAndWait,
    clearTranscript,
  } = useSTT({ config: sttConfig });

  // Session timing: Check last activity and auto-start session
  useEffect(() => {
    if (!isInitialized) return;

    const LAST_ACTIVITY_KEY = 'ramble_last_activity';
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

    // Check if we need to start a new session
    const lastActivityStr = localStorage.getItem(LAST_ACTIVITY_KEY);
    const lastActivity = lastActivityStr ? parseInt(lastActivityStr, 10) : 0;
    const timeSinceLastActivity = Date.now() - lastActivity;

    // Start new session if: no active session OR more than 30min since last activity
    const shouldStartNewSession = !state?.activeSession || timeSinceLastActivity > SESSION_TIMEOUT_MS;

    if (shouldStartNewSession) {
      console.log(`Starting new session (${timeSinceLastActivity > SESSION_TIMEOUT_MS ? 'timeout' : 'no active session'})`);
      startSession();
    }

    // Update activity timestamp
    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    };

    // Initial update
    updateActivity();

    // Set up interval to update every 1 minute
    const heartbeatInterval = setInterval(updateActivity, 60 * 1000);

    return () => clearInterval(heartbeatInterval);
  }, [isInitialized, state?.activeSession, startSession]);

  // Update transcript display
  useEffect(() => {
    setCurrentTranscript(transcript);
  }, [transcript]);

  // Auto-scroll claims container
  useEffect(() => {
    if (claims.length > 0 && claimsContainerRef.current) {
      claimsContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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
      setIsProcessing(true);
      try {
        // Wait for final transcript (handles last words being processed)
        const finalTranscript = await stopRecordingAndWait(10000);

        if (finalTranscript.trim()) {
          await processText(finalTranscript.trim(), 'speech');
        }
      } catch (err) {
        console.error('Failed to process voice text:', err);
      } finally {
        setIsProcessing(false);
        clearTranscript();
        setCurrentTranscript('');
      }
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
  }, [isRecording, sttConnected, connectSTT, startRecording, stopRecordingAndWait, clearTranscript, navigate, processText]);

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
    return claims.filter((c) => c.claimType === selectedClaimType);
  }, [claims, selectedClaimType]);

  // Count claims by type
  const claimTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const claim of claims) {
      counts[claim.claimType] = (counts[claim.claimType] || 0) + 1;
    }
    return counts;
  }, [claims]);

  // Stats summary
  const stats = useMemo(() => ({
    totalClaims: claims.length,
    activeGoals: goals.filter(g => g.status === 'active').length,
    achievedGoals: goals.filter(g => g.status === 'achieved').length,
    unresolvedContradictions: contradictions.filter(c => !c.resolved).length,
    highStakesClaims: claims.filter(c => c.stakes === 'high' || c.stakes === 'existential').length,
    emotionalClaims: claims.filter(c => Math.abs(c.emotionalValence) > 0.5).length,
  }), [claims, goals, contradictions]);

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
      <header className="navbar bg-base-100 border-b border-base-300 px-4 min-h-0 h-14 shrink-0">
        <div className="flex-1 gap-2">
          <h1 className="text-xl font-bold">RAMBLE</h1>
          <div className="hidden md:flex gap-1">
            {queueStatus.isRunning ? (
              <span className="badge badge-success badge-xs gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                Queue
              </span>
            ) : (
              <span className="badge badge-warning badge-xs">Queue Paused</span>
            )}
            {queueStatus.pendingTasks > 0 && (
              <span className="badge badge-info badge-xs">{queueStatus.pendingTasks} pending</span>
            )}
            {queueStatus.failedTasks > 0 && (
              <span className="badge badge-error badge-xs">{queueStatus.failedTasks} failed</span>
            )}
          </div>
        </div>
        <div className="flex-none gap-1">
          {isProcessing && (
            <span className="loading loading-spinner loading-sm text-primary"></span>
          )}
          <button className="btn btn-ghost btn-sm btn-square" onClick={refresh} title="Refresh">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      </header>

      {/* Input Bar */}
      <div className="bg-base-100 border-b border-base-300 p-3 shrink-0">
        <div className="flex gap-2 items-center max-w-5xl mx-auto">
          <button
            className={`btn btn-sm ${isRecording ? 'btn-error animate-pulse' : 'btn-primary'} gap-1`}
            onClick={handleToggleRecording}
            disabled={isProcessing}
          >
            {isRecording ? (
              <>
                <span className="w-2 h-2 rounded-full bg-white"></span>
                Stop
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Record
              </>
            )}
          </button>
          <form onSubmit={handleSubmit} className="flex gap-2 flex-1">
            <input
              ref={inputRef}
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="Share your thoughts..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!inputText.trim() || isProcessing}>
              {isProcessing ? <span className="loading loading-spinner loading-xs"></span> : 'Send'}
            </button>
          </form>
        </div>
        {(currentTranscript || isRecording) && (
          <div className="mt-2 max-w-5xl mx-auto">
            <div className="bg-base-200 p-2 rounded text-sm flex items-center gap-2">
              {isRecording && <span className="loading loading-dots loading-xs text-error"></span>}
              <span className="opacity-70 italic">{currentTranscript || 'Listening...'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Conversations */}
        {showConversations && (
          <div className="w-80 border-r border-base-300 bg-base-100 flex flex-col shrink-0">
            <div className="p-3 border-b border-base-300 flex justify-between items-center">
              <h2 className="font-bold text-sm">Conversation</h2>
              <div className="flex items-center gap-1">
                {/* Raw/Processed Toggle */}
                <div className="join">
                  <button
                    className={`join-item btn btn-xs ${showRawText ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setShowRawText(true)}
                    title="Show raw transcript"
                  >
                    Raw
                  </button>
                  <button
                    className={`join-item btn btn-xs ${!showRawText ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setShowRawText(false)}
                    title="Show sanitized/processed text"
                  >
                    Clean
                  </button>
                </div>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setShowConversations(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {conversations.length === 0 ? (
                <p className="text-center text-sm opacity-50 py-8">
                  No conversation yet.<br />Start speaking or typing.
                </p>
              ) : (
                <>
                  {/* Show more button at top (for loading older conversations) */}
                  {conversations.length > conversationsDisplayLimit && (
                    <div className="text-center py-2">
                      <button
                        className="btn btn-sm btn-ghost gap-2"
                        onClick={() => setConversationsDisplayLimit(prev => prev + 20)}
                      >
                        <span>↑</span>
                        Show {Math.min(20, conversations.length - conversationsDisplayLimit)} more older
                      </button>
                      <div className="text-xs opacity-50 mt-1">
                        Showing {conversationsDisplayLimit} of {conversations.length} conversations
                      </div>
                    </div>
                  )}

                  {conversations.slice().reverse().slice(0, conversationsDisplayLimit).map((conv, index, arr) => {
                    const displayText = showRawText ? conv.rawText : conv.sanitizedText;
                    const hasChanges = conv.rawText !== conv.sanitizedText;

                    // Check if this is the start of a new session
                    const prevConv = arr[index + 1]; // reversed array, so next item is previous chronologically
                    const isSessionStart = !prevConv || prevConv.sessionId !== conv.sessionId;

                    return (
                      <div key={conv.id}>
                        {/* Session marker */}
                        {isSessionStart && (
                          <div className="flex items-center gap-2 my-3">
                            <div className="flex-1 border-t border-base-300"></div>
                            <div className="text-xs opacity-50 flex items-center gap-1">
                              <span className="font-mono">📍</span>
                              <span>Session started</span>
                              <span className="font-mono">{new Date(conv.timestamp).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}</span>
                            </div>
                            <div className="flex-1 border-t border-base-300"></div>
                          </div>
                        )}

                        {/* Conversation unit */}
                        <div
                          className={`p-2 rounded-lg text-sm ${
                            conv.processed ? 'bg-base-200' : 'bg-warning/10 border border-warning/30'
                          }`}
                        >
                          <p className="leading-relaxed">{displayText}</p>
                          {/* Show diff indicator when there are changes */}
                          {hasChanges && (
                            <div className="mt-1 text-xs">
                              {showRawText ? (
                                <span className="text-info opacity-70">📝 Has sanitized version</span>
                              ) : (
                                <span className="text-success opacity-70">✨ Cleaned from raw</span>
                              )}
                            </div>
                          )}
                          <div className="flex justify-between items-center mt-1 text-xs opacity-50">
                            <div className="flex gap-1 items-center">
                              <span className={`w-1.5 h-1.5 rounded-full ${conv.source === 'speech' ? 'bg-primary' : 'bg-secondary'}`}></span>
                              <span>{conv.source}</span>
                              {!conv.processed && <span className="text-warning">processing...</span>}
                            </div>
                            <span>{new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats Bar */}
          <div className="bg-base-100 border-b border-base-300 p-2 flex gap-4 overflow-x-auto shrink-0">
            {!showConversations && (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setShowConversations(true)}
              >
                ☰ Conv
              </button>
            )}
            <div className="flex gap-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="font-bold text-lg">{stats.totalClaims}</span>
                <span className="opacity-50">claims</span>
              </div>
              <div className="divider divider-horizontal m-0"></div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-lg text-success">{stats.activeGoals}</span>
                <span className="opacity-50">active goals</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-lg">{entities.length}</span>
                <span className="opacity-50">entities</span>
              </div>
              {stats.unresolvedContradictions > 0 && (
                <>
                  <div className="divider divider-horizontal m-0"></div>
                  <div className="flex items-center gap-1 text-error">
                    <span className="font-bold text-lg">{stats.unresolvedContradictions}</span>
                    <span className="opacity-70">contradictions</span>
                  </div>
                </>
              )}
              {stats.highStakesClaims > 0 && (
                <div className="flex items-center gap-1 text-warning">
                  <span className="font-bold">{stats.highStakesClaims}</span>
                  <span className="opacity-70">high stakes</span>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs tabs-boxed bg-base-200 m-2 mb-0 shrink-0">
            <button
              className={`tab tab-sm ${activeTab === 'memory' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              Memory
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'claims' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('claims')}
            >
              Claims ({claims.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'entities' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('entities')}
            >
              Entities ({entities.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'goals' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('goals')}
            >
              Goals ({goals.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'patterns' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('patterns')}
            >
              Patterns ({patterns.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'corrections' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('corrections')}
            >
              Corrections ({corrections.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'insights' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('insights')}
            >
              Insights
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'extractors' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('extractors')}
            >
              Extractors
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Memory Tab */}
            {activeTab === 'memory' && (
              <MemoryTab
                workingMemory={workingMemory}
                longTermMemory={longTermMemory}
                topOfMind={topOfMind}
                memoryStats={memoryStats}
                onRecordAccess={recordMemoryAccess}
              />
            )}

            {/* Extractors & Observers Tab */}
            {activeTab === 'extractors' && (
              <ExtractorsObserversTab
                extractors={extractors}
                observers={observers}
                observerStats={observerStats}
                onToggleExtractor={toggleExtractor}
                onToggleObserver={toggleObserver}
              />
            )}

            {/* Claims Tab */}
            {activeTab === 'claims' && (
              <div className="space-y-4">
                {/* Claim Type Filter */}
                <div className="flex flex-wrap gap-1">
                  <button
                    className={`badge badge-sm cursor-pointer ${!selectedClaimType ? 'badge-primary' : 'badge-ghost'}`}
                    onClick={() => setSelectedClaimType(null)}
                  >
                    All ({claims.length})
                  </button>
                  {Object.entries(claimTypeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <button
                        key={type}
                        className={`badge badge-sm cursor-pointer ${
                          selectedClaimType === type ? CLAIM_TYPE_COLORS[type] || 'badge-primary' : 'badge-ghost'
                        }`}
                        onClick={() => setSelectedClaimType(selectedClaimType === type ? null : type)}
                      >
                        {type.replace('_', ' ')} ({count})
                      </button>
                    ))}
                </div>

                {/* Claims List */}
                <div ref={claimsContainerRef} className="space-y-2">
                  {filteredClaims.length === 0 ? (
                    <div className="text-center py-12 opacity-50">
                      <div className="text-4xl mb-2">💭</div>
                      <p>{claims.length === 0 ? 'No claims yet. Start sharing your thoughts!' : 'No claims match this filter.'}</p>
                    </div>
                  ) : (
                    <>
                      {filteredClaims.slice().reverse().map((claim, i) => (
                        <ClaimCard key={claim.id} claim={claim} isLatest={i === 0} />
                      ))}

                      {/* Show More button if there are more claims in DB */}
                      {claims.length < claimCount && (
                        <div className="text-center py-4">
                          <button
                            onClick={() => loadMoreClaims(50)}
                            className="btn btn-outline btn-sm gap-2"
                          >
                            <Icon icon="mdi:chevron-down" className="w-4 h-4" />
                            Show More ({claimCount - claims.length} more claims available)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Entities Tab */}
            {activeTab === 'entities' && (
              <div className="space-y-4">
                {entities.length === 0 ? (
                  <div className="text-center py-12 opacity-50">
                    <div className="text-4xl mb-2">👥</div>
                    <p>No entities detected yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {entities
                      .slice()
                      .sort((a, b) => b.mentionCount - a.mentionCount)
                      .map((entity) => (
                        <EntityCard key={entity.id} entity={entity} />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Goals Tab */}
            {activeTab === 'goals' && (
              <div className="space-y-4">
                {goals.length === 0 ? (
                  <div className="text-center py-12 opacity-50">
                    <div className="text-4xl mb-2">🎯</div>
                    <p>No goals detected yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {goals.map((goal) => (
                      <GoalCard key={goal.id} goal={goal} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Patterns Tab */}
            {activeTab === 'patterns' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Patterns */}
                  <div>
                    <h3 className="font-bold text-sm uppercase opacity-70 mb-3">Detected Patterns</h3>
                    {patterns.length === 0 ? (
                      <div className="text-center py-8 opacity-50">
                        <div className="text-3xl mb-2">🔍</div>
                        <p className="text-sm">No patterns detected yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {patterns.map((pattern) => (
                          <PatternCard key={pattern.id} pattern={pattern} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Contradictions */}
                  <div>
                    <h3 className="font-bold text-sm uppercase opacity-70 mb-3">Contradictions</h3>
                    {contradictions.length === 0 ? (
                      <div className="text-center py-8 opacity-50">
                        <div className="text-3xl mb-2">✓</div>
                        <p className="text-sm">No contradictions detected.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {contradictions.map((c) => {
                          const claimA = claims.find(cl => cl.id === c.claimAId) || null;
                          const claimB = claims.find(cl => cl.id === c.claimBId) || null;
                          return (
                            <ContradictionCard
                              key={c.id}
                              contradiction={c}
                              claimA={claimA}
                              claimB={claimB}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Corrections Tab */}
            {activeTab === 'corrections' && (
              <div className="space-y-4">
                {/* Global Search & Replace */}
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                    <span>🔍</span> Global Search & Replace
                  </h3>
                  <p className="text-xs opacity-70 mb-3">
                    Search and replace text across all conversations, claims, entities, and goals.
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="label label-text text-xs py-0">Find text</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Text to find..."
                          value={searchQuery}
                          onChange={async (e) => {
                            setSearchQuery(e.target.value);
                            setReplaceResult(null);
                            if (e.target.value.trim().length >= 2) {
                              setSearchResults(await searchText(e.target.value.trim()));
                            } else {
                              setSearchResults([]);
                            }
                          }}
                        />
                      </div>
                      <div className="text-base-content/50 pb-2">→</div>
                      <div className="flex-1">
                        <label className="label label-text text-xs py-0">Replace with</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Replacement text..."
                          value={replaceQuery}
                          onChange={(e) => {
                            setReplaceQuery(e.target.value);
                            setReplaceResult(null);
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="label cursor-pointer gap-2">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-primary"
                          checked={addAsCorrection}
                          onChange={(e) => setAddAsCorrection(e.target.checked)}
                        />
                        <span className="label-text text-xs">Also add as future STT correction</span>
                      </label>
                      <button
                        className="btn btn-warning btn-sm"
                        disabled={!searchQuery.trim() || !replaceQuery.trim() || searchResults.length === 0}
                        onClick={async () => {
                          if (searchQuery.trim() && replaceQuery.trim()) {
                            const result = await replaceText(searchQuery.trim(), replaceQuery.trim(), {
                              addAsCorrection,
                            });
                            setReplaceResult(result);
                            setSearchResults([]);
                            setSearchQuery('');
                            setReplaceQuery('');
                          }
                        }}
                      >
                        Replace All ({searchResults.length} matches)
                      </button>
                    </div>
                  </div>

                  {/* Search Results Preview */}
                  {searchResults.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-warning/30">
                      <div className="text-xs font-bold opacity-70 mb-2">
                        Found {searchResults.length} matches:
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {searchResults.slice(0, 20).map((result, i) => (
                          <div key={`${result.id}-${result.field}-${i}`} className="flex items-center gap-2 text-xs bg-base-100 p-2 rounded">
                            <span className={`badge badge-xs ${
                              result.type === 'conversation' ? 'badge-info' :
                              result.type === 'claim' ? 'badge-primary' :
                              result.type === 'entity' ? 'badge-success' :
                              result.type === 'goal' ? 'badge-warning' : 'badge-secondary'
                            }`}>
                              {result.type}
                            </span>
                            <span className="opacity-50">{result.field}:</span>
                            <span className="flex-1 truncate font-mono">{result.context}</span>
                          </div>
                        ))}
                        {searchResults.length > 20 && (
                          <div className="text-xs text-center opacity-50">
                            ... and {searchResults.length - 20} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Replace Result */}
                  {replaceResult && (
                    <div className="mt-3 pt-3 border-t border-success/30 bg-success/10 -m-4 p-4 rounded-b-lg">
                      <div className="text-xs font-bold text-success mb-2">
                        ✓ Replaced {replaceResult.totalReplacements} occurrences
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {replaceResult.conversationsUpdated > 0 && (
                          <span className="badge badge-xs badge-info">{replaceResult.conversationsUpdated} conversations</span>
                        )}
                        {replaceResult.claimsUpdated > 0 && (
                          <span className="badge badge-xs badge-primary">{replaceResult.claimsUpdated} claims</span>
                        )}
                        {replaceResult.entitiesUpdated > 0 && (
                          <span className="badge badge-xs badge-success">{replaceResult.entitiesUpdated} entities</span>
                        )}
                        {replaceResult.goalsUpdated > 0 && (
                          <span className="badge badge-xs badge-warning">{replaceResult.goalsUpdated} goals</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Add New Correction for Future STT */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-3">Add Future STT Correction</h3>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const wrongInput = form.elements.namedItem('wrong') as HTMLInputElement;
                      const correctInput = form.elements.namedItem('correct') as HTMLInputElement;
                      if (wrongInput.value.trim() && correctInput.value.trim()) {
                        await addCorrection(wrongInput.value.trim(), correctInput.value.trim());
                        wrongInput.value = '';
                        correctInput.value = '';
                      }
                    }}
                    className="flex gap-2 items-end"
                  >
                    <div className="flex-1">
                      <label className="label label-text text-xs py-0">Wrong spelling</label>
                      <input
                        type="text"
                        name="wrong"
                        className="input input-bordered input-sm w-full"
                        placeholder="e.g., Micheal"
                      />
                    </div>
                    <div className="text-base-content/50 pb-2">→</div>
                    <div className="flex-1">
                      <label className="label label-text text-xs py-0">Correct spelling</label>
                      <input
                        type="text"
                        name="correct"
                        className="input input-bordered input-sm w-full"
                        placeholder="e.g., Michael"
                      />
                    </div>
                    <button type="submit" className="btn btn-primary btn-sm">Add</button>
                  </form>
                  <p className="text-xs opacity-50 mt-2">
                    Tip: You can also say "I meant X not Y" while speaking and the system will learn automatically.
                  </p>
                </div>

                {/* Learned Corrections List */}
                {corrections.length === 0 ? (
                  <div className="text-center py-12 opacity-50">
                    <div className="text-4xl mb-2">📝</div>
                    <p>No corrections learned yet.</p>
                    <p className="text-sm mt-2">
                      Say "I meant X not Y" while recording or add corrections manually above.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h3 className="font-bold text-sm opacity-70">
                      Learned Corrections ({corrections.length})
                    </h3>
                    {corrections
                      .slice()
                      .sort((a, b) => b.usageCount - a.usageCount)
                      .map((correction) => (
                        <CorrectionCard
                          key={correction.id}
                          correction={correction}
                          onRemove={removeCorrection}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Insights Tab */}
            {activeTab === 'insights' && (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="stat bg-base-200 rounded-lg p-4">
                    <div className="stat-title text-xs">Total Claims</div>
                    <div className="stat-value text-2xl">{stats.totalClaims}</div>
                  </div>
                  <div className="stat bg-base-200 rounded-lg p-4">
                    <div className="stat-title text-xs">Active Goals</div>
                    <div className="stat-value text-2xl text-success">{stats.activeGoals}</div>
                    <div className="stat-desc">{stats.achievedGoals} achieved</div>
                  </div>
                  <div className="stat bg-base-200 rounded-lg p-4">
                    <div className="stat-title text-xs">Entities Known</div>
                    <div className="stat-value text-2xl">{entities.length}</div>
                  </div>
                </div>

                {/* Claim Type Distribution */}
                {Object.keys(claimTypeCounts).length > 0 && (
                  <div className="bg-base-200 rounded-lg p-4">
                    <h3 className="font-bold text-sm mb-3">Claim Distribution</h3>
                    <div className="space-y-2">
                      {Object.entries(claimTypeCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center gap-2">
                            <span className="w-24 text-xs truncate">{type.replace('_', ' ')}</span>
                            <progress
                              className="progress progress-primary flex-1 h-2"
                              value={count}
                              max={Math.max(...Object.values(claimTypeCounts))}
                            />
                            <span className="text-xs w-8 text-right">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Task Queue Status */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-3">Processing Queue</h3>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div>
                      <div className={`text-2xl font-bold ${queueStatus.isRunning ? 'text-success' : 'text-warning'}`}>
                        {queueStatus.isRunning ? '●' : '○'}
                      </div>
                      <div className="text-xs opacity-50">{queueStatus.isRunning ? 'Running' : 'Stopped'}</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{queueStatus.pendingTasks}</div>
                      <div className="text-xs opacity-50">Pending</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-primary">{queueStatus.activeTasks}</div>
                      <div className="text-xs opacity-50">Active</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-error">{queueStatus.failedTasks}</div>
                      <div className="text-xs opacity-50">Failed</div>
                    </div>
                  </div>
                  {tasks.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-base-300">
                      <div className="text-xs font-bold opacity-70 mb-2">Recent Tasks</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {tasks.slice(-8).reverse().map((task) => (
                          <div key={task.id} className="flex justify-between text-xs bg-base-100 p-1 rounded">
                            <span className="truncate flex-1 opacity-70">{task.taskType}</span>
                            <span className={`badge badge-xs ${
                              task.status === 'completed' ? 'badge-success' :
                              task.status === 'processing' ? 'badge-primary' :
                              task.status === 'failed' ? 'badge-error' : 'badge-ghost'
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
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-base-100 border-t border-base-300 px-4 py-1.5 shrink-0">
        <div className="flex items-center justify-between text-xs">
          <div className="text-base-content/50 flex items-center gap-3">
            {state?.activeSession ? (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                  Session {state.activeSession.id.slice(0, 8)}
                </span>
                <span>Started {new Date(state.activeSession.startedAt).toLocaleTimeString()}</span>
              </>
            ) : (
              <span>No active session</span>
            )}
            {sttConnected && <span className="badge badge-xs badge-success">STT</span>}
          </div>
          <div className="flex gap-2">
            {state?.activeSession ? (
              <button className="btn btn-xs btn-ghost" onClick={endSession}>End Session</button>
            ) : (
              <button className="btn btn-xs btn-primary" onClick={startSession}>Start Session</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
