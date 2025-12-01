/**
 * Observer Page - Main UI for the Observer System
 *
 * Simple dump view showing all data:
 * - Sessions, Messages, Knowledge Items
 * - Tags, Categories, Privacy, Entities
 * - Session State, System Thinking
 * - Suggestions
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  observerHelpers,
  type Session,
  type Message,
  type KnowledgeItem,
  type Tag,
  type Category,
  type Privacy,
  type Entity,
  type Suggestion,
} from '../stores/observerStore';
import { settingsHelpers } from '../stores/settingsStore';
import { useSTT } from '../services/stt/useSTT';
import type { STTConfig } from '../services/stt/types';
import { initializeObserverSystem, enqueueMessage } from '../services/observer/api';

export function ObserverPage() {
  const navigate = useNavigate();

  // Current session
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Global data
  const [tags, setTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [privacyList, setPrivacyList] = useState<Privacy[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);

  // Current session details
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

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
        onStatusChange: (status, description) => {
          console.log('[ObserverPage] Queue status:', status, description);
        },
        onError: (err) => {
          console.error('[ObserverPage] Observer error:', err);
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

    const session = observerHelpers.getSession(currentSessionId);
    setCurrentSession(session || null);

    const unsubMessages = observerHelpers.subscribeToMessages(currentSessionId, setMessages);
    const unsubKnowledge = observerHelpers.subscribeToKnowledge(currentSessionId, setKnowledgeItems);
    const unsubSuggestions = observerHelpers.subscribeToSuggestions(currentSessionId, setSuggestions);

    return () => {
      unsubMessages();
      unsubKnowledge();
      unsubSuggestions();
    };
  }, [currentSessionId]);

  // Update transcript display
  useEffect(() => {
    setCurrentTranscript(transcript);
  }, [transcript]);

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
              <div className="space-y-2 max-h-64 overflow-auto">
                {messages.map((m) => (
                  <div key={m.id} className="bg-base-200 p-2 rounded">
                    <div className="flex justify-between items-center mb-1">
                      <span className={`badge badge-sm ${m.role === 'user' ? 'badge-primary' : 'badge-secondary'}`}>
                        {m.role}
                      </span>
                      <span className="text-xs opacity-50">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm">{m.raw}</div>
                    {m.processed && m.processed !== m.raw && (
                      <div className="text-sm text-success mt-1">→ {m.processed}</div>
                    )}
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="text-sm opacity-50">No messages yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Knowledge Items */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Knowledge Items ({knowledgeItems.length})
              </h2>
              <div className="space-y-2 max-h-64 overflow-auto">
                {knowledgeItems.map((k) => (
                  <div key={k.id} className="bg-base-200 p-2 rounded">
                    {k.contents.map((c, i) => (
                      <div key={i} className="text-sm mb-1">
                        <span>{c.text}</span>
                        {c.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {c.tags.map((t) => (
                              <span key={t} className="badge badge-xs">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {k.entities.length > 0 && (
                      <div className="text-xs opacity-50 mt-1">
                        Entities: {k.entities.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
                {knowledgeItems.length === 0 && (
                  <div className="text-sm opacity-50">No knowledge items yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">
                Suggestions ({suggestions.length})
              </h2>
              <div className="space-y-2 max-h-64 overflow-auto">
                {suggestions.map((s) => (
                  <div key={s.id} className="bg-base-200 p-2 rounded">
                    {s.contents.map((c, i) => (
                      <div key={i} className="text-sm mb-1">
                        <span className={`badge badge-xs mr-2 ${
                          c.type === 'question' ? 'badge-info' :
                          c.type === 'essential' ? 'badge-error' :
                          c.type === 'improvement' ? 'badge-success' :
                          'badge-warning'
                        }`}>
                          {c.type}
                        </span>
                        {c.text}
                      </div>
                    ))}
                  </div>
                ))}
                {suggestions.length === 0 && (
                  <div className="text-sm opacity-50">No suggestions yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Tags</h2>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t.name}
                    className="badge"
                    style={{ backgroundColor: t.color, color: 'white' }}
                  >
                    {t.name}
                    {!t.commit && <span className="ml-1 opacity-50">(suggested)</span>}
                  </span>
                ))}
                {tags.length === 0 && (
                  <div className="text-sm opacity-50">No tags yet</div>
                )}
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-sm font-bold uppercase opacity-70">Categories</h2>
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <span
                    key={c.name}
                    className="badge"
                    style={{ backgroundColor: c.color, color: 'white' }}
                  >
                    {c.name}
                    {!c.commit && <span className="ml-1 opacity-50">(suggested)</span>}
                  </span>
                ))}
                {categories.length === 0 && (
                  <div className="text-sm opacity-50">No categories yet</div>
                )}
              </div>
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
                    style={{ backgroundColor: p.color, color: 'white' }}
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
              <h2 className="card-title text-sm font-bold uppercase opacity-70">System Thinking</h2>
              {currentSession?.systemThinking ? (
                <div className="space-y-2 text-sm">
                  {currentSession.systemThinking.summary && (
                    <div>
                      <span className="font-bold">Summary:</span> {currentSession.systemThinking.summary}
                    </div>
                  )}
                  {currentSession.systemThinking.goals.length > 0 && (
                    <div>
                      <span className="font-bold">Goals:</span>
                      <ul className="list-disc list-inside">
                        {currentSession.systemThinking.goals.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentSession.systemThinking.plan.length > 0 && (
                    <div>
                      <span className="font-bold">Plan:</span>
                      <ul className="list-decimal list-inside">
                        {currentSession.systemThinking.plan.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentSession.systemThinking.errors.length > 0 && (
                    <div>
                      <span className="font-bold text-error">Errors:</span>
                      <ul className="list-disc list-inside text-error">
                        {currentSession.systemThinking.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!currentSession.systemThinking.summary &&
                    currentSession.systemThinking.goals.length === 0 &&
                    currentSession.systemThinking.plan.length === 0 &&
                    currentSession.systemThinking.errors.length === 0 && (
                    <div className="text-sm opacity-50">No system thinking yet</div>
                  )}
                </div>
              ) : (
                <div className="text-sm opacity-50">No system thinking yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
