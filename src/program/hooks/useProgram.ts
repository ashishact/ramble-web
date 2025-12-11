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
  type Goal,
  type Entity,
  type Pattern,
  type Contradiction,
  type ConversationSource,
  type ConversationUnit,
  type Task,
  type Correction,
  type TopOfMind,
  type MemoryStats,
  type ExtractionProgramRecord,
  type DispatcherStats,
} from '../index';
import type { SearchResult, ReplaceResult } from '../kernel/kernel';

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

  /** Total count of all claims in database */
  claimCount: number;

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

  /** All corrections */
  corrections: Correction[];

  /** Queue status */
  queueStatus: {
    isRunning: boolean;
    activeTasks: number;
    pendingTasks: number;
    failedTasks: number;
  };

  // Memory System
  /** Working memory claims (high salience) */
  workingMemory: Claim[];

  /** Long-term memory claims */
  longTermMemory: Claim[];

  /** Top of mind snapshot */
  topOfMind: TopOfMind | null;

  /** Memory statistics */
  memoryStats: MemoryStats | null;

  /** All extraction programs */
  extractors: ExtractionProgramRecord[];

  /** All registered observers */
  observers: Array<{ type: string; name: string; description: string; active: boolean }>;

  /** Observer stats */
  observerStats: DispatcherStats | null;

  /** Start a new session */
  startSession: () => void;

  /** End current session */
  endSession: () => void;

  /** Process text input */
  processText: (text: string, source: ConversationSource) => Promise<void>;

  /** Manually add a correction */
  addCorrection: (wrongText: string, correctText: string) => Correction | null;

  /** Remove a correction */
  removeCorrection: (id: string) => boolean;

  /** Search text across all data */
  searchText: (query: string, options?: { caseSensitive?: boolean }) => SearchResult[];

  /** Replace text across all data */
  replaceText: (
    searchText: string,
    replaceText: string,
    options?: { caseSensitive?: boolean; addAsCorrection?: boolean }
  ) => ReplaceResult;

  /** Record access to a claim (boosts salience) */
  recordMemoryAccess: (claimId: string) => void;

  /** Promote claim to long-term memory */
  promoteToLongTerm: (claimId: string, reason?: string) => boolean;

  /** Toggle extractor on/off */
  toggleExtractor: (id: string, active: boolean) => void;

  /** Toggle observer on/off */
  toggleObserver: (type: string, active: boolean) => void;

  /** Load more claims */
  loadMoreClaims: (additionalCount?: number) => void;

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
  const [claimCount, setClaimCount] = useState<number>(0);
  const [claimLimit, setClaimLimit] = useState<number>(50);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [conversations, setConversations] = useState<ConversationUnit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [queueStatus, setQueueStatus] = useState({
    isRunning: false,
    activeTasks: 0,
    pendingTasks: 0,
    failedTasks: 0,
  });

  // Memory System state
  const [workingMemory, setWorkingMemory] = useState<Claim[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<Claim[]>([]);
  const [topOfMind, setTopOfMind] = useState<TopOfMind | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);

  // Extractors & Observers state
  const [extractors, setExtractors] = useState<ExtractionProgramRecord[]>([]);
  const [observers, setObservers] = useState<Array<{ type: string; name: string; description: string; active: boolean }>>([]);
  const [observerStats, setObserverStats] = useState<DispatcherStats | null>(null);

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
      setClaims(kernel.getClaims(claimLimit)); // Limited claims
      setClaimCount(kernel.getClaimCount()); // Total count
      setGoals(kernel.getGoals());
      setEntities(kernel.getEntities());
      setPatterns(kernel.getPatterns());
      setContradictions(kernel.getContradictions());
      setConversations(kernel.getConversations());
      setTasks(kernel.getTasks());
      setCorrections(kernel.getCorrections());
      setQueueStatus(kernel.getQueueStatus());

      // Memory System
      setWorkingMemory(kernel.getWorkingMemory());
      setLongTermMemory(kernel.getLongTermMemory());
      setTopOfMind(kernel.getTopOfMind());
      setMemoryStats(kernel.getMemoryStats());

      // Extractors & Observers
      setExtractors(kernel.getExtractionPrograms());
      setObservers(kernel.getRegisteredObservers());
      setObserverStats(kernel.getObserverStats());
    } catch (err) {
      console.error('Failed to refresh program data:', err);
    }
  }, [claimLimit]);

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

  // Add correction
  const addCorrection = useCallback((wrongText: string, correctText: string): Correction | null => {
    const kernel = kernelRef.current;
    if (!kernel) return null;

    const result = kernel.addCorrection(wrongText, correctText);
    refresh();
    return result;
  }, [refresh]);

  // Remove correction
  const removeCorrection = useCallback((id: string): boolean => {
    const kernel = kernelRef.current;
    if (!kernel) return false;

    const result = kernel.removeCorrection(id);
    refresh();
    return result;
  }, [refresh]);

  // Search text
  const searchText = useCallback((query: string, options?: { caseSensitive?: boolean }): SearchResult[] => {
    const kernel = kernelRef.current;
    if (!kernel) return [];
    return kernel.searchText(query, options);
  }, []);

  // Replace text
  const replaceText = useCallback((
    search: string,
    replace: string,
    options?: { caseSensitive?: boolean; addAsCorrection?: boolean }
  ): ReplaceResult => {
    const kernel = kernelRef.current;
    if (!kernel) {
      return { conversationsUpdated: 0, claimsUpdated: 0, entitiesUpdated: 0, goalsUpdated: 0, totalReplacements: 0 };
    }
    const result = kernel.replaceText(search, replace, options);
    refresh();
    return result;
  }, [refresh]);

  // Record memory access
  const recordMemoryAccess = useCallback((claimId: string): void => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    kernel.recordMemoryAccess(claimId);
  }, []);

  // Promote to long-term memory
  const promoteToLongTerm = useCallback((claimId: string, reason?: string): boolean => {
    const kernel = kernelRef.current;
    if (!kernel) return false;
    const result = kernel.promoteToLongTerm(claimId, reason);
    refresh();
    return result;
  }, [refresh]);

  // Toggle extractor
  const toggleExtractor = useCallback((id: string, active: boolean): void => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    kernel.toggleExtractor(id, active);
    refresh();
  }, [refresh]);

  // Toggle observer
  const toggleObserver = useCallback((type: string, active: boolean): void => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    kernel.toggleObserver(type, active);
    refresh();
  }, [refresh]);

  // Load more claims
  const loadMoreClaims = useCallback((additionalCount: number = 50): void => {
    setClaimLimit((prev) => prev + additionalCount);
  }, []);

  return {
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
    startSession,
    endSession,
    processText,
    addCorrection,
    removeCorrection,
    searchText,
    replaceText,
    recordMemoryAccess,
    promoteToLongTerm,
    toggleExtractor,
    toggleObserver,
    loadMoreClaims,
    refresh,
    // Memory System
    workingMemory,
    longTermMemory,
    topOfMind,
    memoryStats,
    // Extractors & Observers
    extractors,
    observers,
    observerStats,
  };
}
