/**
 * useObserver Hook
 *
 * React hook for integrating with the Observer System.
 * Handles:
 * - Session management
 * - Queue status monitoring
 * - Automatic observer initialization
 * - Message submission
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  initializeObserverSystem,
  enqueueMessage,
  resumeSession,
  type QueueStatus,
} from '../services/observer/api';
import {
  observerHelpers,
  type Session,
  type Message,
  type KnowledgeItem,
  type Suggestion,
} from '../stores/observerStore';

export interface UseObserverOptions {
  sessionId?: string;
  autoCreateSession?: boolean;
}

export interface UseObserverReturn {
  // Session
  session: Session | null;
  sessionId: string | null;
  createSession: (name?: string) => Session;
  switchSession: (id: string) => void;
  allSessions: Session[];

  // Messages
  messages: Message[];
  addMessage: (text: string, role?: 'user' | 'ai') => void;

  // Knowledge & Suggestions
  knowledgeItems: KnowledgeItem[];
  suggestions: Suggestion[];

  // Queue status
  queueStatus: QueueStatus;
  queueDescription: string;

  // State
  isProcessing: boolean;
  error: Error | null;
}

export function useObserver(options: UseObserverOptions = {}): UseObserverReturn {
  const { sessionId: initialSessionId, autoCreateSession = true } = options;

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [session, setSession] = useState<Session | null>(null);
  const [allSessions, setAllSessions] = useState<Session[]>([]);

  // Data state
  const [messages, setMessages] = useState<Message[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Queue state
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('idle');
  const [queueDescription, setQueueDescription] = useState('');

  // Error state
  const [error, setError] = useState<Error | null>(null);

  // Track if initialized
  const initializedRef = useRef(false);

  // Initialize observer system
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Initialize with callbacks
    initializeObserverSystem({
      onStatusChange: (status, description) => {
        setQueueStatus(status);
        setQueueDescription(description || '');
      },
      onError: (err) => {
        setError(err);
        console.error('[useObserver] Queue error:', err);
      },
    });

    // Initialize store
    const initStore = async () => {
      await observerHelpers.ensureReady();

      // Subscribe to sessions
      const unsubSessions = observerHelpers.subscribeToSessions(setAllSessions);

      // Get or create initial session
      const sessions = observerHelpers.getAllSessions();
      if (initialSessionId) {
        setSessionId(initialSessionId);
      } else if (sessions.length > 0) {
        setSessionId(sessions[0].id);
      } else if (autoCreateSession) {
        const newSession = observerHelpers.createSession();
        setSessionId(newSession.id);
      }

      return () => {
        unsubSessions();
      };
    };

    initStore();
  }, [initialSessionId, autoCreateSession]);

  // Subscribe to current session data
  useEffect(() => {
    if (!sessionId) return;

    // Get session
    const currentSession = observerHelpers.getSession(sessionId);
    setSession(currentSession || null);

    // Subscribe to session-specific data
    const unsubMessages = observerHelpers.subscribeToMessages(sessionId, setMessages);
    const unsubKnowledge = observerHelpers.subscribeToKnowledge(sessionId, setKnowledgeItems);
    const unsubSuggestions = observerHelpers.subscribeToSuggestions(sessionId, setSuggestions);

    // Check if session needs analysis on resume
    resumeSession(sessionId).catch(console.error);

    return () => {
      unsubMessages();
      unsubKnowledge();
      unsubSuggestions();
    };
  }, [sessionId]);

  // Create a new session
  const createSession = useCallback((name?: string): Session => {
    const newSession = observerHelpers.createSession(name);
    setSessionId(newSession.id);
    return newSession;
  }, []);

  // Switch to a different session
  const switchSession = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  // Add a message and enqueue for processing
  const addMessage = useCallback((text: string, role: 'user' | 'ai' = 'user') => {
    if (!sessionId) {
      console.error('[useObserver] No session selected');
      return;
    }

    // Add message to store
    const message = observerHelpers.addMessage(sessionId, role, text);

    // Enqueue for observer processing (only for user messages)
    if (role === 'user') {
      enqueueMessage(message.id, sessionId);
    }
  }, [sessionId]);

  return {
    // Session
    session,
    sessionId,
    createSession,
    switchSession,
    allSessions,

    // Messages
    messages,
    addMessage,

    // Knowledge & Suggestions
    knowledgeItems,
    suggestions,

    // Queue status
    queueStatus,
    queueDescription,

    // State
    isProcessing: queueStatus === 'processing',
    error,
  };
}
