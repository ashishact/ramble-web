/**
 * Program Page - Main UI for the RAMBLE System
 *
 * Enhanced UI with tabbed panels, detailed views, and better usability.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgram } from '../program/hooks';
import { VoiceRecorder } from './VoiceRecorder';
import type { Claim, Entity, Goal, Correction } from '../program';
import type { ExtractionTraceRecord } from '../db/stores/extractionTraceStore';
import type { Vocabulary, VocabularyEntityType } from '../program/schemas/vocabulary';
import type { CanonicalSuggestion } from '../program/services/vocabularyService';
import { getVariantVotes, parseContextHints } from '../program/schemas/vocabulary';
import { programStore } from '../program/store';

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

function ClaimCard({ claim, isLatest, onViewTrace, loadingTrace }: {
  claim: Claim;
  isLatest: boolean;
  onViewTrace?: (id: string) => void;
  loadingTrace?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
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
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {onViewTrace && (
              <button
                className="btn btn-ghost btn-xs btn-square"
                onClick={(e) => { e.stopPropagation(); onViewTrace(claim.id); }}
                disabled={loadingTrace === claim.id}
                title="View extraction debug"
              >
                {loadingTrace === claim.id ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  '🔍'
                )}
              </button>
            )}
            {isLatest ? (
              <LiveRelativeTime timestamp={claim.createdAt} />
            ) : (
              <span className="text-xs opacity-50">{formatRelativeTime(claim.createdAt)}</span>
            )}
          </div>
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

function VocabularyCard({
  vocab,
  suggestion,
  onDelete,
  onApplySuggestion,
  onCorrectCanonical,
}: {
  vocab: Vocabulary;
  suggestion?: CanonicalSuggestion;
  onDelete: (id: string) => Promise<boolean>;
  onApplySuggestion?: (suggestion: CanonicalSuggestion) => Promise<void>;
  onCorrectCanonical?: (id: string, newCanonical: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newCanonical, setNewCanonical] = useState(vocab.correctSpelling);

  const variants = getVariantVotes(vocab.variantCountsJson);
  const contextHints = parseContextHints(vocab.contextHints);

  return (
    <div className="p-3 bg-base-200 rounded-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{vocab.correctSpelling}</span>
            <span className="badge badge-xs badge-outline">{vocab.entityType}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs opacity-60">
            <span className="font-mono">{vocab.phoneticPrimary}</span>
            <span>•</span>
            <span>Used {vocab.usageCount}x</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▲' : '▼'}
          </button>
          <button
            className="btn btn-ghost btn-xs btn-square text-error"
            onClick={() => onDelete(vocab.id)}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Suggestion alert */}
      {suggestion && (
        <div className="mt-2 bg-warning/20 border border-warning/30 rounded p-2">
          <div className="flex items-center justify-between">
            <div className="text-xs">
              <span className="opacity-70">Suggested: </span>
              <span className="font-bold">{suggestion.suggestedCanonical}</span>
              <span className="opacity-50 ml-1">({Math.round(suggestion.confidence * 100)}% confidence)</span>
            </div>
            {onApplySuggestion && (
              <button
                className="btn btn-xs btn-warning"
                onClick={() => onApplySuggestion(suggestion)}
              >
                Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-base-300 space-y-3">
          {/* Manual canonical correction */}
          <div>
            <div className="text-xs font-bold opacity-70 mb-1">Canonical Spelling</div>
            {editing ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input input-xs input-bordered flex-1"
                  value={newCanonical}
                  onChange={(e) => setNewCanonical(e.target.value)}
                />
                <button
                  className="btn btn-xs btn-primary"
                  onClick={async () => {
                    if (onCorrectCanonical && newCanonical.trim() !== vocab.correctSpelling) {
                      await onCorrectCanonical(vocab.id, newCanonical.trim());
                    }
                    setEditing(false);
                  }}
                >
                  Save
                </button>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => {
                    setNewCanonical(vocab.correctSpelling);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{vocab.correctSpelling}</span>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Context hints */}
          {contextHints.length > 0 && (
            <div>
              <div className="text-xs font-bold opacity-70 mb-1">Context Hints</div>
              <div className="flex flex-wrap gap-1">
                {contextHints.map((hint, i) => (
                  <span key={i} className="badge badge-xs badge-ghost">{hint}</span>
                ))}
              </div>
            </div>
          )}

          {/* STT variants with votes */}
          {variants.length > 0 && (
            <div>
              <div className="text-xs font-bold opacity-70 mb-1">STT Variants (votes)</div>
              <div className="flex flex-wrap gap-1">
                {variants.map((v, i) => (
                  <span
                    key={i}
                    className={`badge badge-xs ${
                      v.variant.toLowerCase() === vocab.correctSpelling.toLowerCase()
                        ? 'badge-success'
                        : 'badge-outline'
                    }`}
                  >
                    {v.variant} ({v.count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Phonetic codes */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="opacity-50">Primary:</span>{' '}
              <span className="font-mono">{vocab.phoneticPrimary}</span>
            </div>
            {vocab.phoneticSecondary && (
              <div>
                <span className="opacity-50">Secondary:</span>{' '}
                <span className="font-mono">{vocab.phoneticSecondary}</span>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="text-xs opacity-50">
            Created {formatRelativeTime(vocab.createdAt)}
            {vocab.lastUsed && <> • Last used {formatRelativeTime(vocab.lastUsed)}</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Extraction Trace Debug Panel
// ============================================================================

function TraceDebugPanel({ trace, onClose }: { trace: ExtractionTraceRecord; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<'span' | 'prompt' | 'response'>('span');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-base-100 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">🔍 Extraction Debug</span>
            <span className="badge badge-outline">{trace.targetType}</span>
            <span className="text-xs font-mono opacity-50">{trace.targetId.slice(0, 12)}...</span>
          </div>
          <button className="btn btn-ghost btn-sm btn-square" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-boxed bg-base-200 m-2 mb-0">
          <button
            className={`tab ${activeSection === 'span' ? 'tab-active' : ''}`}
            onClick={() => setActiveSection('span')}
          >
            Span & Pattern
          </button>
          <button
            className={`tab ${activeSection === 'prompt' ? 'tab-active' : ''}`}
            onClick={() => setActiveSection('prompt')}
          >
            LLM Prompt
          </button>
          <button
            className={`tab ${activeSection === 'response' ? 'tab-active' : ''}`}
            onClick={() => setActiveSection('response')}
          >
            LLM Response
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Span & Pattern Tab */}
          {activeSection === 'span' && (
            <div className="space-y-4">
              {/* Input Text */}
              <div>
                <h4 className="text-sm font-bold mb-2 opacity-70">Input Text</h4>
                <div className="bg-base-200 p-3 rounded-lg text-sm font-mono whitespace-pre-wrap">
                  {trace.inputText}
                </div>
              </div>

              {/* Matched Span */}
              {(trace.matchedText || trace.matchedPattern) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-bold mb-2 opacity-70">Matched Pattern</h4>
                    <div className="bg-info/10 border border-info/30 p-3 rounded-lg text-sm font-mono">
                      {trace.matchedPattern || 'No pattern'}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold mb-2 opacity-70">Matched Text</h4>
                    <div className="bg-success/10 border border-success/30 p-3 rounded-lg text-sm">
                      {trace.matchedText || 'No match'}
                      {trace.charStart !== null && trace.charEnd !== null && (
                        <div className="text-xs opacity-50 mt-1">
                          chars {trace.charStart} - {trace.charEnd}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-base-200 p-3 rounded-lg">
                  <div className="text-xs opacity-50 mb-1">Processing Time</div>
                  <div className="font-bold">{trace.processingTimeMs}ms</div>
                </div>
                <div className="bg-base-200 p-3 rounded-lg">
                  <div className="text-xs opacity-50 mb-1">LLM Model</div>
                  <div className="font-bold font-mono text-xs">{trace.llmModel || 'N/A'}</div>
                </div>
                <div className="bg-base-200 p-3 rounded-lg">
                  <div className="text-xs opacity-50 mb-1">Tokens Used</div>
                  <div className="font-bold">{trace.llmTokensUsed || 'N/A'}</div>
                </div>
              </div>

              {trace.error && (
                <div className="bg-error/10 border border-error/30 p-3 rounded-lg">
                  <h4 className="text-sm font-bold text-error mb-2">Error</h4>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-error">{trace.error}</pre>
                </div>
              )}
            </div>
          )}

          {/* LLM Prompt Tab */}
          {activeSection === 'prompt' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold opacity-70">Full LLM Prompt</h4>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => navigator.clipboard.writeText(trace.llmPrompt || '')}
                >
                  Copy
                </button>
              </div>
              <pre className="bg-base-200 p-4 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[60vh]">
                {trace.llmPrompt || 'No prompt recorded'}
              </pre>
            </div>
          )}

          {/* LLM Response Tab */}
          {activeSection === 'response' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold opacity-70">LLM Response</h4>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => navigator.clipboard.writeText(trace.llmResponse || '')}
                >
                  Copy
                </button>
              </div>
              <pre className="bg-base-200 p-4 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[60vh]">
                {trace.llmResponse || 'No response recorded'}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-base-300 text-xs text-center opacity-50">
          Created: {new Date(trace.createdAt).toLocaleString()} | Extractor: {trace.extractorId || 'unknown'}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

type TabType = 'l1-primitives' | 'l1-mentions' | 'l2-entities' | 'l2-derived' | 'corrections' | 'vocabulary' | 'pipeline';

export function ProgramPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const claimsContainerRef = useRef<HTMLDivElement>(null);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('l2-derived');
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [selectedTrace, setSelectedTrace] = useState<ExtractionTraceRecord | null>(null);
  const [loadingTrace, setLoadingTrace] = useState<string | null>(null);
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
  const [showConversations, setShowConversations] = useState(true);
  const [showRawText, setShowRawText] = useState(false);
  const [conversationsDisplayLimit, setConversationsDisplayLimit] = useState(20);

  const {
    isInitialized,
    isInitializing,
    error,
    state,
    claims,
    goals,
    entities,
    propositions,
    stances,
    relations,
    entityMentions,
    spans,
    conversations,
    corrections,
    queueStatus,
    vocabulary,
    canonicalSuggestions,
    vocabularyStats,
    startSession,
    endSession,
    processText,
    addCorrection,
    removeCorrection,
    searchText,
    replaceText,
    addVocabulary,
    deleteVocabulary,
    correctCanonical,
    applyCanonicalSuggestion,
    syncVocabularyFromEntities,
    refresh,
    pipelineEvents,
    clearPipelineEvents,
  } = useProgram();

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

  // Auto-scroll claims container
  useEffect(() => {
    if (claims.length > 0 && claimsContainerRef.current) {
      claimsContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [claims.length]);

  // Handle voice recording transcript
  const handleVoiceTranscript = useCallback(async (text: string) => {
    setIsProcessing(true);
    try {
      await processText(text, 'speech');
    } catch (err) {
      console.error('Failed to process voice text:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [processText]);

  // Fetch extraction trace for a proposition
  const handleViewTrace = useCallback(async (propositionId: string) => {
    setLoadingTrace(propositionId);
    try {
      const store = programStore.get();
      const traces = await store.extractionTraces.getByTargetId(propositionId);
      if (traces.length > 0) {
        setSelectedTrace(traces[0]);
      } else {
        alert('No extraction trace found for this proposition.');
      }
    } catch (err) {
      console.error('Failed to fetch trace:', err);
      alert('Failed to load extraction trace.');
    } finally {
      setLoadingTrace(null);
    }
  }, []);

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
            {queueStatus.isProcessing ? (
              <span className="badge badge-success badge-xs gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                Processing
              </span>
            ) : (
              <span className="badge badge-neutral badge-xs">Idle</span>
            )}
            {queueStatus.pendingCount > 0 && (
              <span className="badge badge-info badge-xs">{queueStatus.pendingCount} pending</span>
            )}
            {queueStatus.failedCount > 0 && (
              <span className="badge badge-error badge-xs">{queueStatus.failedCount} failed</span>
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
        <div className="flex gap-2 items-start max-w-5xl mx-auto">
          <VoiceRecorder
            onTranscript={handleVoiceTranscript}
            onMissingApiKey={() => {
              alert('Please configure Groq API key in settings');
              navigate('/settings');
            }}
            disabled={isProcessing}
          />
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

                  {/* Load more button at bottom (for older conversations) */}
                  {conversations.length > conversationsDisplayLimit && (
                    <div className="text-center py-3 border-t border-base-300 mt-2">
                      <button
                        className="btn btn-sm btn-ghost gap-2"
                        onClick={() => setConversationsDisplayLimit(prev => prev + 20)}
                      >
                        <span>↓</span>
                        Load {Math.min(20, conversations.length - conversationsDisplayLimit)} older
                      </button>
                      <div className="text-xs opacity-50 mt-1">
                        Showing {Math.min(conversationsDisplayLimit, conversations.length)} of {conversations.length}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs - Layered Architecture */}
          <div className="tabs tabs-boxed bg-base-200 m-2 mb-0 shrink-0">
            <div className="flex items-center gap-1 px-2 opacity-50 text-xs">L1</div>
            <button
              className={`tab tab-sm ${activeTab === 'l1-primitives' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('l1-primitives')}
            >
              Propositions ({propositions.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'l1-mentions' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('l1-mentions')}
            >
              Mentions ({entityMentions.length})
            </button>
            <div className="divider divider-horizontal mx-0"></div>
            <div className="flex items-center gap-1 px-2 opacity-50 text-xs">L2</div>
            <button
              className={`tab tab-sm ${activeTab === 'l2-entities' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('l2-entities')}
            >
              Entities ({entities.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'l2-derived' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('l2-derived')}
            >
              Goals & Claims
            </button>
            <div className="divider divider-horizontal mx-0"></div>
            <button
              className={`tab tab-sm ${activeTab === 'corrections' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('corrections')}
            >
              Corrections
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'vocabulary' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('vocabulary')}
            >
              Vocabulary ({vocabulary.length})
            </button>
            <button
              className={`tab tab-sm ${activeTab === 'pipeline' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('pipeline')}
            >
              Pipeline {pipelineEvents.length > 0 && `(${pipelineEvents.length})`}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Layer 1: Primitives Tab */}
            {activeTab === 'l1-primitives' && (
              <div className="space-y-4">
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-secondary">L1</span>
                    Propositions & Stances ({propositions.length})
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    What was said (proposition) + how it was held (stance: certainty, desire, obligation, emotion).
                  </p>
                  {propositions.length === 0 ? (
                    <div className="text-center py-8 opacity-50">
                      <p>No propositions yet. Start speaking to see primitives extracted.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {propositions.map((prop) => {
                        const stance = stances.find(s => s.propositionId === prop.id);
                        return (
                          <div key={prop.id} className="bg-base-100 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-sm font-medium">{prop.content}</p>
                                <div className="flex flex-wrap gap-1 mt-2">
                                  <span className="badge badge-xs badge-outline">{prop.type}</span>
                                  <span className="badge badge-xs badge-ghost">{prop.subject}</span>
                                </div>
                              </div>
                              <button
                                className="btn btn-ghost btn-xs btn-square"
                                onClick={() => handleViewTrace(prop.id)}
                                disabled={loadingTrace === prop.id}
                                title="View extraction debug"
                              >
                                {loadingTrace === prop.id ? (
                                  <span className="loading loading-spinner loading-xs"></span>
                                ) : (
                                  '🔍'
                                )}
                              </button>
                            </div>
                            {stance && (
                              <div className="mt-3 pt-3 border-t border-base-300 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                <div>
                                  <span className="opacity-50">Certainty:</span>{' '}
                                  <span className={stance.epistemic.certainty > 0.7 ? 'text-success font-bold' : stance.epistemic.certainty < 0.4 ? 'text-warning' : ''}>
                                    {Math.round(stance.epistemic.certainty * 100)}%
                                  </span>
                                  <span className="opacity-50 ml-1">({stance.epistemic.evidence})</span>
                                </div>
                                {stance.volitional.strength > 0.1 && (
                                  <div>
                                    <span className="opacity-50">Volitional:</span>{' '}
                                    <span className={stance.volitional.valence > 0 ? 'text-success' : 'text-error'}>
                                      {stance.volitional.type || 'neutral'} ({Math.round(stance.volitional.strength * 100)}%)
                                    </span>
                                  </div>
                                )}
                                {stance.deontic.strength > 0.1 && (
                                  <div>
                                    <span className="opacity-50">Deontic:</span>{' '}
                                    <span>{stance.deontic.type || 'none'} ({Math.round(stance.deontic.strength * 100)}%)</span>
                                  </div>
                                )}
                                {(stance.affective.arousal > 0.2 || Math.abs(stance.affective.valence) > 0.2) && (
                                  <div>
                                    <span className="opacity-50">Affect:</span>{' '}
                                    <span className={stance.affective.valence > 0 ? 'text-success' : stance.affective.valence < 0 ? 'text-error' : ''}>
                                      {stance.affective.valence > 0 ? '+' : ''}{stance.affective.valence.toFixed(1)} / {Math.round(stance.affective.arousal * 100)}%
                                    </span>
                                    {stance.affective.emotions && stance.affective.emotions.length > 0 && (
                                      <span className="ml-1 opacity-70">[{stance.affective.emotions.join(', ')}]</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Entity Mentions (L1 - raw references) */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-secondary">L1</span>
                    Entity Mentions ({entityMentions.length})
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Raw text references: pronouns ("he", "she"), names, descriptions. Not yet resolved to canonical entities.
                  </p>
                  {entityMentions.length === 0 ? (
                    <div className="text-center py-4 opacity-50">
                      <p>No entity mentions yet.</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {entityMentions.slice(0, 50).map((mention) => (
                        <div key={mention.id} className="badge badge-outline gap-1">
                          <span className="opacity-60">{mention.mentionType}:</span>
                          <span className="font-medium">"{mention.text}"</span>
                          <span className="text-xs opacity-50">→ {mention.suggestedType}</span>
                        </div>
                      ))}
                      {entityMentions.length > 50 && (
                        <span className="badge badge-ghost">+{entityMentions.length - 50} more</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Relations (L1) */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-secondary">L1</span>
                    Relations ({relations.length})
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    How propositions connect: causal, temporal, logical relationships.
                  </p>
                  {relations.length === 0 ? (
                    <div className="text-center py-4 opacity-50">
                      <p>No relations detected yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {relations.slice(0, 20).map((relation) => (
                        <div key={relation.id} className="bg-base-100 rounded p-2 text-xs flex items-center gap-2">
                          <span className="badge badge-xs badge-info">{relation.category}</span>
                          <span className="opacity-60">{relation.subtype}</span>
                          <span className="flex-1 text-right opacity-50">strength: {Math.round(relation.strength * 100)}%</span>
                        </div>
                      ))}
                      {relations.length > 20 && (
                        <div className="text-center text-xs opacity-50">+{relations.length - 20} more</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Spans (L1) */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-secondary">L1</span>
                    Spans ({spans.length})
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Pattern matches found in text (deterministic, no LLM).
                  </p>
                  {spans.length === 0 ? (
                    <div className="text-center py-4 opacity-50">
                      <p>No spans detected yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {spans.slice(0, 20).map((span) => (
                        <div key={span.id} className="bg-base-100 rounded p-2 text-xs flex items-center gap-2">
                          <span className="badge badge-xs badge-ghost">{span.patternId || 'pattern'}</span>
                          <span className="font-mono flex-1 truncate">"{span.textExcerpt}"</span>
                          <span className="opacity-50">[{span.charStart}-{span.charEnd}]</span>
                        </div>
                      ))}
                      {spans.length > 20 && (
                        <div className="text-center text-xs opacity-50">+{spans.length - 20} more</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Layer 1: Entity Mentions Tab */}
            {activeTab === 'l1-mentions' && (
              <div className="space-y-4">
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-secondary">L1</span>
                    Entity Mentions ({entityMentions.length})
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Raw text references extracted from speech. These get resolved into L2 canonical entities.
                  </p>
                  {entityMentions.length === 0 ? (
                    <div className="text-center py-8 opacity-50">
                      <div className="text-3xl mb-2">👤</div>
                      <p>No entity mentions yet.</p>
                      <p className="text-xs mt-2">Try saying something with names or pronouns like "I", "he", "John", "my boss"</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {entityMentions.map((mention) => (
                        <div key={mention.id} className="bg-base-100 rounded-lg p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="badge badge-sm badge-outline">{mention.mentionType}</span>
                            <span className="font-medium">"{mention.text}"</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs opacity-60">
                            <span>→ {mention.suggestedType}</span>
                            {mention.resolvedEntityId && (
                              <span className="badge badge-xs badge-success">resolved</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Layer 2: Entities Tab */}
            {activeTab === 'l2-entities' && (
              <div className="space-y-4">
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-accent">L2</span>
                    Entities
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Canonical entities resolved from L1 mentions.
                  </p>
                  {entities.length === 0 ? (
                    <div className="text-center py-8 opacity-50">
                      <div className="text-3xl mb-2">👥</div>
                      <p>No entities detected yet.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {entities.map((entity) => (
                        <EntityCard key={entity.id} entity={entity} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Layer 2: Derived Tab */}
            {activeTab === 'l2-derived' && (
              <div className="space-y-4">
                {/* Goals */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-accent">L2</span>
                    Goals
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Derived from propositions with volitional/teleological stance.
                  </p>
                  {goals.length === 0 ? (
                    <div className="text-center py-8 opacity-50">
                      <div className="text-3xl mb-2">🎯</div>
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

                {/* Claims */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <span className="badge badge-xs badge-accent">L2</span>
                    Claims
                  </h3>
                  <p className="text-xs opacity-70 mb-4">
                    Derived from proposition + stance. Tracked over time with confidence decay.
                  </p>
                  {claims.length === 0 ? (
                    <div className="text-center py-8 opacity-50">
                      <div className="text-3xl mb-2">💭</div>
                      <p>No claims yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {claims.slice(0, 10).map((claim, i) => (
                        <ClaimCard
                          key={claim.id}
                          claim={claim}
                          isLatest={i === 0}
                          onViewTrace={handleViewTrace}
                          loadingTrace={loadingTrace}
                        />
                      ))}
                      {claims.length > 10 && (
                        <div className="text-center text-xs opacity-50 py-2">
                          + {claims.length - 10} more claims
                        </div>
                      )}
                    </div>
                  )}
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

            {/* Vocabulary Tab */}
            {activeTab === 'vocabulary' && (
              <div className="space-y-4">
                {/* Stats Banner */}
                {vocabularyStats && (
                  <div className="stats shadow bg-base-200">
                    <div className="stat py-2 px-4">
                      <div className="stat-title text-xs">Total Entries</div>
                      <div className="stat-value text-lg">{vocabularyStats.totalEntries}</div>
                    </div>
                    <div className="stat py-2 px-4">
                      <div className="stat-title text-xs">Suggestions</div>
                      <div className="stat-value text-lg text-warning">{vocabularyStats.entriesWithSuggestions}</div>
                    </div>
                    <div className="stat py-2 px-4">
                      <div className="stat-title text-xs">Total Variants</div>
                      <div className="stat-value text-lg">{vocabularyStats.totalVariants}</div>
                    </div>
                    <div className="stat py-2 px-4">
                      <div className="stat-title text-xs">Avg Variants/Entry</div>
                      <div className="stat-value text-lg">{vocabularyStats.averageVariantsPerEntry.toFixed(1)}</div>
                    </div>
                  </div>
                )}

                {/* Sync from Entities */}
                <div className="bg-base-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-sm">Sync from Entities</h3>
                      <p className="text-xs opacity-70">
                        Create vocabulary entries for existing entities that don't have them yet.
                      </p>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={async () => {
                        const count = await syncVocabularyFromEntities();
                        if (count > 0) {
                          alert(`Created ${count} vocabulary entries from entities.`);
                        } else {
                          alert('All entities already have vocabulary entries.');
                        }
                      }}
                    >
                      Sync Now
                    </button>
                  </div>
                </div>

                {/* Add New Vocabulary */}
                <div className="bg-base-200 rounded-lg p-4">
                  <h3 className="font-bold text-sm mb-3">Add Vocabulary Entry</h3>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const spellingInput = form.elements.namedItem('spelling') as HTMLInputElement;
                      const typeSelect = form.elements.namedItem('entityType') as HTMLSelectElement;
                      const hintsInput = form.elements.namedItem('hints') as HTMLInputElement;

                      if (spellingInput.value.trim()) {
                        const hints = hintsInput.value
                          .split(',')
                          .map(h => h.trim())
                          .filter(h => h.length > 0);

                        await addVocabulary({
                          correctSpelling: spellingInput.value.trim(),
                          entityType: typeSelect.value as VocabularyEntityType,
                          contextHints: hints,
                        });

                        spellingInput.value = '';
                        hintsInput.value = '';
                      }
                    }}
                    className="space-y-3"
                  >
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="label label-text text-xs py-0">Correct Spelling</label>
                        <input
                          type="text"
                          name="spelling"
                          className="input input-bordered input-sm w-full"
                          placeholder="e.g., Michael"
                          required
                        />
                      </div>
                      <div className="w-36">
                        <label className="label label-text text-xs py-0">Entity Type</label>
                        <select
                          name="entityType"
                          className="select select-bordered select-sm w-full"
                          defaultValue="person"
                        >
                          <option value="person">Person</option>
                          <option value="organization">Organization</option>
                          <option value="place">Place</option>
                          <option value="project">Project</option>
                          <option value="product">Product</option>
                          <option value="event">Event</option>
                          <option value="concept">Concept</option>
                          <option value="role">Role</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label label-text text-xs py-0">Context Hints (comma-separated)</label>
                      <input
                        type="text"
                        name="hints"
                        className="input input-bordered input-sm w-full"
                        placeholder="e.g., engineer, friend, colleague"
                      />
                    </div>
                    <button type="submit" className="btn btn-primary btn-sm">Add</button>
                  </form>
                </div>

                {/* Vocabulary List */}
                {vocabulary.length === 0 ? (
                  <div className="text-center py-12 opacity-50">
                    <div className="text-4xl mb-2">📖</div>
                    <p>No vocabulary entries yet.</p>
                    <p className="text-sm mt-2">
                      Add vocabulary manually above or sync from existing entities.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h3 className="font-bold text-sm opacity-70">
                      Vocabulary Entries ({vocabulary.length})
                      {canonicalSuggestions.length > 0 && (
                        <span className="ml-2 text-warning">
                          ({canonicalSuggestions.length} suggestions)
                        </span>
                      )}
                    </h3>
                    {vocabulary
                      .slice()
                      .sort((a, b) => b.usageCount - a.usageCount)
                      .map((vocab) => {
                        const suggestion = canonicalSuggestions.find(s => s.vocabId === vocab.id);
                        return (
                          <VocabularyCard
                            key={vocab.id}
                            vocab={vocab}
                            suggestion={suggestion}
                            onDelete={deleteVocabulary}
                            onApplySuggestion={async (s) => {
                              await applyCanonicalSuggestion(s);
                            }}
                            onCorrectCanonical={async (id, newCanonical) => {
                              await correctCanonical(id, newCanonical);
                            }}
                          />
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Pipeline Tab */}
            {activeTab === 'pipeline' && (() => {
              // Compute current pipeline state from events
              const STEPS = ['preprocess', 'extract', 'resolve', 'derive'] as const;
              type StepStatus = 'pending' | 'running' | 'done' | 'failed';

              // Find the latest events to determine current state
              const getStepStatus = (step: string): { status: StepStatus; data?: Record<string, string | number | boolean> } => {
                // Look for the most recent event for this step
                for (let i = pipelineEvents.length - 1; i >= 0; i--) {
                  const event = pipelineEvents[i];
                  if (event.step === step) {
                    if (event.type === 'queue:step_completed') {
                      return { status: 'done', data: (event.data || {}) as Record<string, string | number | boolean> };
                    }
                    if (event.type === 'queue:item_failed') {
                      return { status: 'failed', data: (event.data || {}) as Record<string, string | number | boolean> };
                    }
                    if (event.type === 'queue:step_started') {
                      // Check if there's a later completed event for this step
                      const hasCompleted = pipelineEvents.slice(i + 1).some(
                        e => e.step === step && e.type === 'queue:step_completed'
                      );
                      if (!hasCompleted && queueStatus.isProcessing) {
                        return { status: 'running' };
                      }
                      return { status: 'done' }; // Assume done if not processing
                    }
                  }
                }
                return { status: 'pending' };
              };

              // Get current text being processed
              const currentText = pipelineEvents.length > 0
                ? (pipelineEvents[pipelineEvents.length - 1].data as Record<string, unknown>)?.text as string
                : null;

              // Get completed units (count item_completed events)
              const completedUnits = pipelineEvents.filter(e => e.type === 'queue:item_completed').length;

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm">Pipeline Monitor</h3>
                      {queueStatus.isProcessing ? (
                        <span className="badge badge-success badge-sm gap-1">
                          <span className="loading loading-spinner loading-xs"></span>
                          Processing
                        </span>
                      ) : (
                        <span className="badge badge-neutral badge-sm">Idle</span>
                      )}
                    </div>
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={clearPipelineEvents}
                      disabled={pipelineEvents.length === 0}
                    >
                      Clear Log
                    </button>
                  </div>

                  {/* Current Pipeline Progress */}
                  {queueStatus.isProcessing && (
                    <div className="bg-base-200 rounded-lg p-4">
                      <h4 className="font-bold text-xs mb-3 opacity-70">Current Pipeline</h4>

                      {/* Text being processed */}
                      {currentText && (
                        <div className="text-sm mb-4 p-2 bg-base-300 rounded italic truncate" title={currentText}>
                          "{currentText}"
                        </div>
                      )}

                      {/* Step progress */}
                      <div className="flex items-center gap-2">
                        {STEPS.map((step, idx) => {
                          const { status, data } = getStepStatus(step);
                          return (
                            <div key={step} className="flex items-center gap-2">
                              <div className={`flex flex-col items-center ${
                                status === 'running' ? 'text-info' :
                                status === 'done' ? 'text-success' :
                                status === 'failed' ? 'text-error' :
                                'text-base-content/30'
                              }`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                                  status === 'running' ? 'border-info bg-info/20' :
                                  status === 'done' ? 'border-success bg-success/20' :
                                  status === 'failed' ? 'border-error bg-error/20' :
                                  'border-base-content/20'
                                }`}>
                                  {status === 'running' ? (
                                    <span className="loading loading-spinner loading-sm"></span>
                                  ) : status === 'done' ? (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : status === 'failed' ? (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  ) : (
                                    <span className="text-xs">{idx + 1}</span>
                                  )}
                                </div>
                                <span className="text-xs mt-1 capitalize">{step}</span>
                                {status === 'done' && data && (
                                  <span className="text-[10px] opacity-60">
                                    {data.spansFound !== undefined && `${data.spansFound} spans`}
                                    {data.propositions !== undefined && `${data.propositions} props`}
                                    {data.mentionsResolved !== undefined && `${data.mentionsResolved} resolved`}
                                    {data.claimsCreated !== undefined && `${data.claimsCreated} claims`}
                                  </span>
                                )}
                              </div>
                              {idx < STEPS.length - 1 && (
                                <div className={`w-8 h-0.5 ${
                                  getStepStatus(STEPS[idx + 1]).status !== 'pending' ? 'bg-success' : 'bg-base-content/20'
                                }`} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Queue Stats */}
                  <div className="bg-base-200 rounded-lg p-4">
                    <h4 className="font-bold text-xs mb-2 opacity-70">Queue Stats</h4>
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-primary">
                          {queueStatus.isProcessing ? 1 : 0}
                        </div>
                        <div className="text-xs opacity-60">Active</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-info">
                          {queueStatus.pendingCount}
                        </div>
                        <div className="text-xs opacity-60">Pending</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-success">
                          {queueStatus.completedCount}
                        </div>
                        <div className="text-xs opacity-60">Completed</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-error">
                          {queueStatus.failedCount}
                        </div>
                        <div className="text-xs opacity-60">Failed</div>
                      </div>
                    </div>
                  </div>

                  {/* Completed Units Summary */}
                  {completedUnits > 0 && !queueStatus.isProcessing && (
                    <div className="bg-success/10 rounded-lg p-4 border border-success/30">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm font-medium">
                          {completedUnits} unit{completedUnits !== 1 ? 's' : ''} processed successfully
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Simple Event Log */}
                  <div className="bg-base-200 rounded-lg p-4">
                    <h4 className="font-bold text-xs mb-2 opacity-70">Event Log ({pipelineEvents.length})</h4>
                    {pipelineEvents.length === 0 ? (
                      <div className="text-center py-8 opacity-50">
                        <p>No events yet. Process some text to see pipeline events.</p>
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
                        {[...pipelineEvents].reverse().map((event, index) => {
                          const data = (event.data || {}) as Record<string, string | number | boolean>;
                          const isCompleted = event.type.includes('completed');
                          const isFailed = event.type.includes('failed');

                          // Format the event nicely
                          let icon = '•';
                          let color = 'opacity-50';
                          if (isCompleted) { icon = '✓'; color = 'text-success'; }
                          if (isFailed) { icon = '✗'; color = 'text-error'; }
                          if (event.type.includes('started')) { icon = '→'; color = 'text-info'; }

                          // Build description
                          let desc = event.step || event.type.replace('queue:', '');
                          if (data.description) desc = String(data.description);

                          // Add stats for completed
                          const stats: string[] = [];
                          if (data.spansFound) stats.push(`${data.spansFound} spans`);
                          if (data.propositions) stats.push(`${data.propositions} props`);
                          if (data.entityMentions) stats.push(`${data.entityMentions} mentions`);
                          if (data.claimsCreated) stats.push(`${data.claimsCreated} claims`);
                          if (data.skipped) stats.push('skipped');

                          return (
                            <div key={`${event.timestamp}-${index}`} className="flex items-start gap-2 py-1">
                              <span className={`${color} w-4`}>{icon}</span>
                              <span className="opacity-40 w-16 shrink-0">
                                {new Date(event.timestamp).toLocaleTimeString()}
                              </span>
                              <span className="flex-1">
                                {desc}
                                {stats.length > 0 && (
                                  <span className="opacity-50 ml-2">({stats.join(', ')})</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
      </div>

      {/* Extraction Trace Debug Modal */}
      {selectedTrace && (
        <TraceDebugPanel trace={selectedTrace} onClose={() => setSelectedTrace(null)} />
      )}

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
