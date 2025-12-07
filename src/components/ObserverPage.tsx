/**
 * Observer Page - Main UI for the Observer System
 *
 * Simple dump view showing all data:
 * - Sessions, Messages, Knowledge Items
 * - Tags, Categories, Privacy, Entities
 * - Session State, System Thinking
 * - Suggestions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// ============================================================================
// Live Relative Time Component
// ============================================================================

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hr${remainingHours !== 1 ? 's' : ''} ago`;
    }
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} hr${hours !== 1 ? 's' : ''} ${remainingMinutes} min ago`;
    }
    return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes} min ${remainingSeconds} sec ago`;
  }

  return `${seconds} sec ago`;
}

function LiveRelativeTime({ timestamp }: { timestamp: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Update every second for live feel
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-xs opacity-60 font-mono">
      {formatRelativeTime(timestamp)}
    </span>
  );
}

import {
  observerHelpers,
  PALETTE,
  type Session,
  type Message,
  type KnowledgeItem,
  type Tag,
  type Category,
  type Privacy,
  type Entity,
  type Suggestion,
  type ObserverError,
  type ObserverPhase,
} from '../stores/observerStore';

// Suggestion type colors using global palette
const SUGGESTION_TYPE_COLORS: Record<string, { bg: string; badge: string }> = {
  question: { bg: PALETTE.powderBlue, badge: 'badge-info' },
  essential: { bg: PALETTE.rosewater, badge: 'badge-error' },
  improvement: { bg: PALETTE.pastelMint, badge: 'badge-success' },
  nudge: { bg: PALETTE.butterCream, badge: 'badge-warning' },
};
import { settingsHelpers } from '../stores/settingsStore';
import { useSTT } from '../services/stt/useSTT';
import type { STTConfig } from '../services/stt/types';
import { initializeObserverSystem, enqueueMessage, runSystem2Thinker, retryObserverError } from '../services/observer/api';

export function ObserverPage() {
  const navigate = useNavigate();

  // Current session
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Refs for auto-scrolling (refs to scrollable containers)
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const knowledgeContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  // Global data
  const [tags, setTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [privacyList, setPrivacyList] = useState<Privacy[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);

  // Current session details
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  // System 2 Thinker state
  const [isRunningSystem2, setIsRunningSystem2] = useState(false);

  // Manage mode for tags/categories
  const [manageTagsMode, setManageTagsMode] = useState(false);
  const [manageCategoriesMode, setManageCategoriesMode] = useState(false);

  // Observer errors (persistent, from store)
  const [observerErrors, setObserverErrors] = useState<ObserverError[]>([]);
  const [retryingErrorId, setRetryingErrorId] = useState<string | null>(null);

  // Processing status (live indicator)
  const [processingStatus, setProcessingStatus] = useState<{
    isProcessing: boolean;
    description?: string;
    phase?: ObserverPhase;
  }>({ isProcessing: false });

  // Input state
  const [inputText, setInputText] = useState('');
  const [currentTranscript, setCurrentTranscript] = useState('');

  // STT config
  const sttConfig: STTConfig = useMemo(() => ({
    provider: 'groq-whisper',
    apiKey: settingsHelpers.getApiKey('groq') || '',
    chunkingStrategy: 'vad',
  }), []);

  // STT hook
  const {
    isConnected: sttConnected,
    isRecording,
    transcript,
    connect: connectSTT,
    disconnect: disconnectSTT,
    startRecording,
    stopRecording,
  } = useSTT({ config: sttConfig });

  // Initialize store and create/load session
  useEffect(() => {
    const init = async () => {
      await observerHelpers.ensureReady();

      // Initialize the observer system
      initializeObserverSystem({
        onStatusChange: (status, description, phase) => {
          console.log('[ObserverPage] Queue status:', status, description, phase);
          setProcessingStatus({
            isProcessing: status === 'processing',
            description,
            phase,
          });
        },
        onError: (err, phase) => {
          // Errors are now saved to the store and displayed via subscription
          console.error('[ObserverPage] Observer error:', err, 'phase:', phase);
          // Clear processing status on error
          setProcessingStatus({ isProcessing: false });
        },
      });

      // Subscribe to sessions
      const unsubSessions = observerHelpers.subscribeToSessions(setSessions);

      // Subscribe to global data
      const unsubTags = observerHelpers.subscribeToTags(setTags);
      const unsubCategories = observerHelpers.subscribeToCategories(setCategories);
      const unsubEntities = observerHelpers.subscribeToEntities(setEntities);

      // Load privacy
      setPrivacyList(observerHelpers.getAllPrivacy());

      // Create or get session
      const allSessions = observerHelpers.getAllSessions();
      if (allSessions.length > 0) {
        // Use most recent session
        setCurrentSessionId(allSessions[0].id);
      } else {
        // Create new session
        const newSession = observerHelpers.createSession();
        setCurrentSessionId(newSession.id);
      }

      return () => {
        unsubSessions();
        unsubTags();
        unsubCategories();
        unsubEntities();
      };
    };

    init();
  }, []);

  // Subscribe to current session data
  useEffect(() => {
    if (!currentSessionId) return;

    const unsubMessages = observerHelpers.subscribeToMessages(currentSessionId, setMessages);
    const unsubKnowledge = observerHelpers.subscribeToKnowledge(currentSessionId, setKnowledgeItems);
    const unsubSuggestions = observerHelpers.subscribeToSuggestions(currentSessionId, setSuggestions);
    const unsubErrors = observerHelpers.subscribeToObserverErrors(currentSessionId, setObserverErrors);

    return () => {
      unsubMessages();
      unsubKnowledge();
      unsubSuggestions();
      unsubErrors();
    };
  }, [currentSessionId]);

  // Update currentSession reactively when sessions change
  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }
    const session = sessions.find(s => s.id === currentSessionId);
    setCurrentSession(session || null);
  }, [currentSessionId, sessions]);

  // Update transcript display
  useEffect(() => {
    setCurrentTranscript(transcript);
  }, [transcript]);

  // Auto-scroll to new messages (scroll within container only)
  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length]);

  // Auto-scroll to new knowledge items (scroll within container only)
  useEffect(() => {
    if (knowledgeItems.length > 0 && knowledgeContainerRef.current) {
      const container = knowledgeContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [knowledgeItems.length]);

  // Auto-scroll to new suggestions (scroll within container only)
  useEffect(() => {
    if (suggestions.length > 0 && suggestionsContainerRef.current) {
      const container = suggestionsContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [suggestions.length]);

  // Connect STT on mount (only once)
  useEffect(() => {
    let mounted = true;

    const initSTT = async () => {
      const groqApiKey = settingsHelpers.getApiKey('groq');
      if (groqApiKey && mounted) {
        try {
          await connectSTT();
        } catch (err) {
          console.error('[ObserverPage] STT connection error:', err);
        }
      }
    };

    initSTT();

    return () => {
      mounted = false;
      disconnectSTT();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Handle recording toggle
  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      // Save the transcript as a message when recording stops
      if (transcript.trim() && currentSessionId) {
        const message = observerHelpers.addMessage(currentSessionId, 'user', transcript.trim());
        // Enqueue for observer processing
        enqueueMessage(message.id, currentSessionId);
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
  }, [isRecording, transcript, currentSessionId, sttConnected, connectSTT, startRecording, stopRecording, navigate]);

  // Handle text input submit
  const handleSubmit = useCallback(() => {
    if (!inputText.trim() || !currentSessionId) return;

    const message = observerHelpers.addMessage(currentSessionId, 'user', inputText.trim());
    // Enqueue for observer processing
    enqueueMessage(message.id, currentSessionId);
    setInputText('');
  }, [inputText, currentSessionId]);

  // Handle new session
  const handleNewSession = useCallback(() => {
    const newSession = observerHelpers.createSession();
    setCurrentSessionId(newSession.id);
  }, []);

  // Handle session selection
  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  // Handle manual System 2 Thinker run
  const handleRunSystem2 = useCallback(async () => {
    if (!currentSessionId || isRunningSystem2) return;

    setIsRunningSystem2(true);
    try {
      await runSystem2Thinker(currentSessionId, knowledgeItems.length);
    } catch (err) {
      console.error('[ObserverPage] System 2 Thinker error:', err);
    } finally {
      setIsRunningSystem2(false);
    }
  }, [currentSessionId, isRunningSystem2, knowledgeItems.length]);

  // Helper to get category color with light tint
  const getCategoryBgColor = (categoryName: string): string => {
    const category = categories.find(c => c.name === categoryName);
    if (!category?.color) return 'transparent';
    // Convert hex to rgba with low opacity
    const hex = category.color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.15)`;
  };

  // Helper to get tag color
  const getTagColor = (tagName: string): string => {
    const tag = tags.find(t => t.name === tagName);
    return tag?.color || '#6b7280';
  };

  // Helper to get contrasting text color (black or white) based on background luminance
  const getContrastTextColor = (hexColor: string): string => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Calculate relative luminance using sRGB formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Use dark text for light backgrounds, white text for dark backgrounds
    return luminance > 0.6 ? '#1f2937' : '#ffffff';
  };

  // System 2 progress calculation
  const SYSTEM2_THRESHOLD = 16;
  const system2Progress = knowledgeItems.length % SYSTEM2_THRESHOLD;
  const system2Remaining = SYSTEM2_THRESHOLD - system2Progress;
  const hasSystemThinking = currentSession?.systemThinking?.summary ||
    (currentSession?.systemThinking?.goals?.length ?? 0) > 0 ||
    (currentSession?.systemThinking?.plan?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-base-300 flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-lg">
        <div className="flex-1">
          <span className="text-xl font-bold px-4">Observer System</span>
        </div>
        <div className="flex-none gap-2">
          <button className="btn btn-sm btn-primary" onClick={handleNewSession}>
            New Session
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/settings')}>
            Settings
          </button>
        </div>
      </div>

      {/* Error Banner - Shows all unresolved errors with retry */}
      {observerErrors.length > 0 && (
        <div className="bg-error/90 text-error-content px-4 py-3">
          <div className="max-w-4xl mx-auto space-y-2">
            {observerErrors.map((err) => (
              <div key={err.id} className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-semibold">
                    Observer Error ({err.phase})
                    {err.retryData.messageIds && (
                      <span className="font-normal opacity-80 ml-2">
                        ({err.retryData.messageIds.length} message{err.retryData.messageIds.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                  <div className="text-sm opacity-90 mt-1">
                    {err.error}
                  </div>
                  <div className="text-xs opacity-70 mt-1">
                    {new Date(err.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className={`btn btn-sm btn-warning ${retryingErrorId === err.id ? 'loading' : ''}`}
                    onClick={async () => {
                      setRetryingErrorId(err.id);
                      try {
                        await retryObserverError(err.id);
                      } catch (retryErr) {
                        console.error('Retry failed:', retryErr);
                      } finally {
                        setRetryingErrorId(null);
                      }
                    }}
                    disabled={retryingErrorId !== null}
                  >
                    {retryingErrorId === err.id ? 'Retrying...' : 'Retry'}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => observerHelpers.deleteObserverError(err.id)}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Bar (top) */}
      <div className="bg-base-100 border-b border-base-300 p-4">
        <div className="flex gap-2 items-center max-w-4xl mx-auto">
          <button
            className={`btn ${isRecording ? 'btn-error' : 'btn-primary'}`}
            onClick={handleToggleRecording}
          >
            {isRecording ? 'Stop' : 'Record'}
          </button>
          <input
            type="text"
            className="input input-bordered flex-1"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!inputText.trim()}>
            Send
          </button>
        </div>
        {currentTranscript && (
          <div className="mt-2 max-w-4xl mx-auto">
            <div className="bg-base-200 p-2 rounded text-sm opacity-70">
              Transcribing: {currentTranscript}
            </div>
          </div>
        )}
      </div>

      {/* Main Content - Grid Layout */}
      <div className="flex-1 p-4 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Sessions */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Sessions</h2>
              <div className="space-y-1 max-h-48 overflow-auto">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`p-2 rounded cursor-pointer hover:bg-base-200 ${
                      s.id === currentSessionId ? 'bg-primary/10 border border-primary' : ''
                    }`}
                    onClick={() => handleSelectSession(s.id)}
                  >
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs opacity-50">
                      {new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <div className="text-sm opacity-50">No sessions yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Messages ({messages.length})
              </h2>
              <div ref={messagesContainerRef} className="space-y-2 max-h-64 overflow-auto">
                {messages.map((m, index) => {
                  const isLast = index === messages.length - 1;
                  return (
                    <div key={m.id} className="bg-base-200 p-2 rounded">
                      <div className="flex justify-between items-center mb-1">
                        <span className={`badge badge-sm ${m.role === 'user' ? 'badge-primary' : 'badge-secondary'}`}>
                          {m.role}
                        </span>
                        {isLast ? (
                          <LiveRelativeTime timestamp={m.timestamp} />
                        ) : (
                          <span className="text-xs opacity-50">
                            {new Date(m.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div className="text-sm">{m.raw}</div>
                      {m.processed && m.processed !== m.raw && (
                        <div className="text-sm text-success mt-1">→ {m.processed}</div>
                      )}
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="text-sm opacity-50">No messages yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Knowledge Items */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-sm font-bold uppercase opacity-70">
                  Knowledge Items ({knowledgeItems.length})
                </h2>
                {processingStatus.isProcessing && processingStatus.phase === 'knowledge' && (
                  <div className="flex items-center gap-2 text-info">
                    <span className="loading loading-spinner loading-xs"></span>
                    <span className="text-xs">Extracting...</span>
                  </div>
                )}
              </div>
              <div ref={knowledgeContainerRef} className="space-y-2 max-h-64 overflow-auto">
                {knowledgeItems.map((k, index) => {
                  const isLast = index === knowledgeItems.length - 1;
                  return (
                    <div key={k.id} className="p-2 rounded space-y-1">
                      {k.contents.map((c, i) => (
                        <div
                          key={i}
                          className="text-sm p-2 rounded"
                          style={{ backgroundColor: getCategoryBgColor(c.category) }}
                        >
                          <div className="flex items-start gap-2">
                            <span className="flex-1">{c.text}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.category && (() => {
                              const catColor = categories.find(cat => cat.name === c.category)?.color || '#6b7280';
                              return (
                                <span
                                  className="badge badge-xs"
                                  style={{ backgroundColor: catColor, color: getContrastTextColor(catColor) }}
                                >
                                  {c.category}
                                </span>
                              );
                            })()}
                            {c.tags.map((t) => {
                              const tagColor = getTagColor(t);
                              return (
                                <span
                                  key={t}
                                  className="badge badge-xs"
                                  style={{ backgroundColor: tagColor, color: getContrastTextColor(tagColor) }}
                                >
                                  {t}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {k.entities.length > 0 && (
                        <div className="text-xs opacity-50 mt-1 pl-2">
                          Entities: {k.entities.join(', ')}
                        </div>
                      )}
                      {isLast && (
                        <div className="text-right mt-1">
                          <LiveRelativeTime timestamp={k.createdAt} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {knowledgeItems.length === 0 && (
                  <div className="text-sm opacity-50">No knowledge items yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-sm font-bold uppercase opacity-70">
                  Suggestions ({suggestions.length})
                </h2>
                {processingStatus.isProcessing && processingStatus.phase === 'suggestion' && (
                  <div className="flex items-center gap-2 text-info">
                    <span className="loading loading-spinner loading-xs"></span>
                    <span className="text-xs">Generating...</span>
                  </div>
                )}
              </div>
              <div ref={suggestionsContainerRef} className="space-y-2 max-h-64 overflow-auto">
                {suggestions.map((s, index) => {
                  const isLast = index === suggestions.length - 1;
                  return (
                    <div key={s.id} className="space-y-1">
                      {s.contents.map((c, i) => {
                        const typeColors = SUGGESTION_TYPE_COLORS[c.type] || SUGGESTION_TYPE_COLORS.nudge;
                        return (
                          <div
                            key={i}
                            className="text-sm p-2 rounded"
                            style={{ backgroundColor: typeColors.bg, color: getContrastTextColor(typeColors.bg) }}
                          >
                            <span
                              className="badge badge-xs mr-2"
                              style={{ backgroundColor: typeColors.bg, color: getContrastTextColor(typeColors.bg), borderColor: getContrastTextColor(typeColors.bg) }}
                            >
                              {c.type}
                            </span>
                            {c.text}
                          </div>
                        );
                      })}
                      {isLast && (
                        <div className="text-right mt-1">
                          <LiveRelativeTime timestamp={s.createdAt} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {suggestions.length === 0 && (
                  <div className="text-sm opacity-50">No suggestions yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between mb-2">
                <h2 className="card-title text-sm font-bold uppercase opacity-70 mb-0">Tags</h2>
                <button
                  className={`btn btn-xs ${manageTagsMode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setManageTagsMode(!manageTagsMode)}
                >
                  {manageTagsMode ? 'Done' : 'Manage'}
                </button>
              </div>
              {manageTagsMode ? (
                <div className="space-y-3">
                  {/* Committed Tags */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Committed</div>
                    <div className="flex flex-wrap gap-1">
                      {tags.filter(t => t.commit).map((t) => (
                        <span
                          key={t.name}
                          className="badge"
                          style={{ backgroundColor: t.color, color: getContrastTextColor(t.color) }}
                        >
                          {t.name}
                        </span>
                      ))}
                      {tags.filter(t => t.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                  {/* Suggested Tags */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Suggested</div>
                    <div className="flex flex-wrap gap-1">
                      {tags.filter(t => !t.commit).map((t) => (
                        <span
                          key={t.name}
                          className="badge gap-1"
                          style={{ backgroundColor: t.color, color: getContrastTextColor(t.color) }}
                        >
                          {t.name}
                          <button
                            className="hover:opacity-70"
                            onClick={() => observerHelpers.commitTag(t.name, 'user')}
                            title="Commit"
                          >
                            ✓
                          </button>
                          <button
                            className="hover:opacity-70"
                            onClick={() => observerHelpers.deleteTag(t.name)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {tags.filter(t => !t.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Committed Tags */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Committed</div>
                    <div className="flex flex-wrap gap-1">
                      {tags.filter(t => t.commit).map((t) => (
                        <span
                          key={t.name}
                          className="badge"
                          style={{ backgroundColor: t.color, color: getContrastTextColor(t.color) }}
                        >
                          {t.name}
                        </span>
                      ))}
                      {tags.filter(t => t.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                  {/* Suggested Tags */}
                  {tags.filter(t => !t.commit).length > 0 && (
                    <div>
                      <div className="text-xs font-semibold opacity-60 mb-1">Suggested</div>
                      <div className="flex flex-wrap gap-1">
                        {tags.filter(t => !t.commit).map((t) => (
                          <span
                            key={t.name}
                            className="badge"
                            style={{ backgroundColor: t.color, color: getContrastTextColor(t.color) }}
                          >
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tags.length === 0 && (
                    <div className="text-sm opacity-50">No tags yet</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Categories */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between mb-2">
                <h2 className="card-title text-sm font-bold uppercase opacity-70 mb-0">Categories</h2>
                <button
                  className={`btn btn-xs ${manageCategoriesMode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setManageCategoriesMode(!manageCategoriesMode)}
                >
                  {manageCategoriesMode ? 'Done' : 'Manage'}
                </button>
              </div>
              {manageCategoriesMode ? (
                <div className="space-y-3">
                  {/* Committed Categories */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Committed</div>
                    <div className="flex flex-wrap gap-1">
                      {categories.filter(c => c.commit).map((c) => (
                        <span
                          key={c.name}
                          className="badge"
                          style={{ backgroundColor: c.color, color: getContrastTextColor(c.color) }}
                        >
                          {c.name}
                        </span>
                      ))}
                      {categories.filter(c => c.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                  {/* Suggested Categories */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Suggested</div>
                    <div className="flex flex-wrap gap-1">
                      {categories.filter(c => !c.commit).map((c) => (
                        <span
                          key={c.name}
                          className="badge gap-1"
                          style={{ backgroundColor: c.color, color: getContrastTextColor(c.color) }}
                        >
                          {c.name}
                          <button
                            className="hover:opacity-70"
                            onClick={() => observerHelpers.commitCategory(c.name, 'user')}
                            title="Commit"
                          >
                            ✓
                          </button>
                          <button
                            className="hover:opacity-70"
                            onClick={() => observerHelpers.deleteCategory(c.name)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {categories.filter(c => !c.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Committed Categories */}
                  <div>
                    <div className="text-xs font-semibold opacity-60 mb-1">Committed</div>
                    <div className="flex flex-wrap gap-1">
                      {categories.filter(c => c.commit).map((c) => (
                        <span
                          key={c.name}
                          className="badge"
                          style={{ backgroundColor: c.color, color: getContrastTextColor(c.color) }}
                        >
                          {c.name}
                        </span>
                      ))}
                      {categories.filter(c => c.commit).length === 0 && (
                        <span className="text-xs opacity-50">None</span>
                      )}
                    </div>
                  </div>
                  {/* Suggested Categories */}
                  {categories.filter(c => !c.commit).length > 0 && (
                    <div>
                      <div className="text-xs font-semibold opacity-60 mb-1">Suggested</div>
                      <div className="flex flex-wrap gap-1">
                        {categories.filter(c => !c.commit).map((c) => (
                          <span
                            key={c.name}
                            className="badge"
                            style={{ backgroundColor: c.color, color: getContrastTextColor(c.color) }}
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {categories.length === 0 && (
                    <div className="text-sm opacity-50">No categories yet</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Entities */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Entities</h2>
              <div className="space-y-1 max-h-48 overflow-auto">
                {entities.map((e) => (
                  <div key={e.name} className="flex justify-between items-center text-sm">
                    <span>
                      <span className="badge badge-sm badge-ghost mr-1">{e.type}</span>
                      {e.name}
                    </span>
                    <span className="badge badge-sm">{e.count}</span>
                  </div>
                ))}
                {entities.length === 0 && (
                  <div className="text-sm opacity-50">No entities yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Privacy */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Privacy Scopes</h2>
              <div className="flex flex-wrap gap-1">
                {privacyList.map((p) => (
                  <span
                    key={p.name}
                    className="badge"
                    style={{ backgroundColor: p.color, color: getContrastTextColor(p.color) }}
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Session State */}
          <div className="card bg-base-100 shadow lg:col-span-2">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Session State</h2>
              <pre className="bg-base-200 p-2 rounded text-xs overflow-auto max-h-48">
                {currentSession ? JSON.stringify(currentSession.state, null, 2) : '{}'}
              </pre>
            </div>
          </div>

          {/* System Thinking */}
          <div className="card bg-base-100 shadow xl:col-span-1">
            <div className="card-body">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <h2 className="card-title text-sm font-bold uppercase opacity-70">System Thinking</h2>
                  {processingStatus.isProcessing && processingStatus.phase === 'system2' && (
                    <div className="flex items-center gap-1 text-info">
                      <span className="loading loading-spinner loading-xs"></span>
                      <span className="text-xs">Analyzing...</span>
                    </div>
                  )}
                </div>
                <button
                  className={`btn btn-xs ${isRunningSystem2 ? 'btn-disabled' : 'btn-primary'}`}
                  onClick={handleRunSystem2}
                  disabled={isRunningSystem2 || knowledgeItems.length === 0}
                  title={knowledgeItems.length === 0 ? 'Need knowledge items first' : 'Run deep analysis now'}
                >
                  {isRunningSystem2 ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    'Run Now'
                  )}
                </button>
              </div>

              {/* Progress indicator */}
              <div className="mb-3">
                <div className="flex justify-between text-xs opacity-70 mb-1">
                  <span>{knowledgeItems.length} knowledge items</span>
                  <span>{system2Remaining} more until auto-run</span>
                </div>
                <progress
                  className="progress progress-primary w-full"
                  value={system2Progress}
                  max={SYSTEM2_THRESHOLD}
                ></progress>
              </div>

              {hasSystemThinking ? (
                <div className="space-y-2 text-sm">
                  {currentSession?.systemThinking?.summary && (
                    <div>
                      <span className="font-bold">Summary:</span> {currentSession.systemThinking.summary}
                    </div>
                  )}
                  {(currentSession?.systemThinking?.goals?.length ?? 0) > 0 && (
                    <div>
                      <span className="font-bold">Goals:</span>
                      <ul className="list-disc list-inside">
                        {currentSession!.systemThinking.goals.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(currentSession?.systemThinking?.plan?.length ?? 0) > 0 && (
                    <div>
                      <span className="font-bold">Plan:</span>
                      <ul className="list-decimal list-inside">
                        {currentSession!.systemThinking.plan.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(currentSession?.systemThinking?.errors?.length ?? 0) > 0 && (
                    <div>
                      <span className="font-bold text-error">Errors:</span>
                      <ul className="list-disc list-inside text-error">
                        {currentSession!.systemThinking.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm opacity-50 text-center py-4">
                  No system thinking yet
                  <br />
                  <span className="text-xs">
                    {knowledgeItems.length === 0
                      ? 'Add some messages to generate knowledge'
                      : `${system2Remaining} more knowledge items for auto-analysis, or click "Run Now"`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
