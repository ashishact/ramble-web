/**
 * useProgram Hook
 *
 * React hook for interacting with the Program kernel.
 * Provides reactive access to claims, chains, goals, and patterns.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getKernel,
  type ProgramKernel,
  type KernelState,
  type Claim,
  type ThoughtChain,
  type Goal,
  type Entity,
  type Pattern,
  type Contradiction,
  type ConversationSource,
  type ConversationUnit,
  type Task,
} from '../index';

// ============================================================================
// Types
// ============================================================================

export interface UseProgramReturn {
  /** Whether the kernel is initialized */
  isInitialized: boolean;

  /** Whether initialization is in progress */
  isInitializing: boolean;

  /** Initialization error if any */
  error: string | null;

  /** Kernel state and stats */
  state: KernelState | null;

  /** Recent claims */
  claims: Claim[];

  /** Active thought chains */
  chains: ThoughtChain[];

  /** All goals */
  goals: Goal[];

  /** Known entities */
  entities: Entity[];

  /** Detected patterns */
  patterns: Pattern[];

  /** Detected contradictions */
  contradictions: Contradiction[];

  /** Conversation units in current session */
  conversations: ConversationUnit[];

  /** All tasks (for debugging) */
  tasks: Task[];

  /** Queue status */
  queueStatus: {
    isRunning: boolean;
    activeTasks: number;
    pendingTasks: number;
    failedTasks: number;
  };

  /** Start a new session */
  startSession: () => void;

  /** End current session */
  endSession: () => void;

  /** Process text input */
  processText: (text: string, source: ConversationSource) => Promise<void>;

  /** Manually refresh data */
  refresh: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useProgram(): UseProgramReturn {
  const kernelRef = useRef<ProgramKernel | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<KernelState | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [chains, setChains] = useState<ThoughtChain[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [conversations, setConversations] = useState<ConversationUnit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queueStatus, setQueueStatus] = useState({
    isRunning: false,
    activeTasks: 0,
    pendingTasks: 0,
    failedTasks: 0,
  });

  // Initialize kernel on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (kernelRef.current) return;

      setIsInitializing(true);
      setError(null);

      try {
        const kernel = getKernel();
        await kernel.initialize();

        if (mounted) {
          kernelRef.current = kernel;
          setIsInitialized(true);
          refresh();
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize');
        }
      } finally {
        if (mounted) {
          setIsInitializing(false);
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Refresh data from kernel
  const refresh = useCallback(() => {
    const kernel = kernelRef.current;
    if (!kernel) return;

    try {
      setState(kernel.getState());
      setClaims(kernel.getClaims().slice(-50)); // Last 50 claims
      setChains(kernel.getChains());
      setGoals(kernel.getGoals());
      setEntities(kernel.getEntities());
      setPatterns(kernel.getPatterns());
      setContradictions(kernel.getContradictions());
      setConversations(kernel.getConversations());
      setTasks(kernel.getTasks());
      setQueueStatus(kernel.getQueueStatus());
    } catch (err) {
      console.error('Failed to refresh program data:', err);
    }
  }, []);

  // Poll for updates
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [isInitialized, refresh]);

  // Start session
  const startSession = useCallback(() => {
    const kernel = kernelRef.current;
    if (!kernel) return;

    try {
      kernel.startSession();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    }
  }, [refresh]);

  // End session
  const endSession = useCallback(() => {
    const kernel = kernelRef.current;
    if (!kernel) return;

    try {
      kernel.endSession();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session');
    }
  }, [refresh]);

  // Process text
  const processText = useCallback(async (text: string, source: ConversationSource) => {
    const kernel = kernelRef.current;
    if (!kernel) {
      throw new Error('Kernel not initialized');
    }

    await kernel.processText(text, source);
    // Trigger immediate refresh after processing
    setTimeout(refresh, 100);
  }, [refresh]);

  return {
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
  };
}
