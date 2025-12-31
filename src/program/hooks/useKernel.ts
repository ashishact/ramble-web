/**
 * useKernel Hook
 *
 * React hook for interacting with the kernel
 */

import { useState, useEffect, useCallback } from 'react';
import { getKernel, type KernelState, type InputResult } from '../kernel';

export function useKernel() {
  const kernel = getKernel();
  const [state, setState] = useState<KernelState>(kernel.getState());
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize kernel on mount
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await kernel.initialize();
      if (mounted) {
        setIsInitialized(true);
      }
    };

    init();

    // Subscribe to state changes
    const unsubscribe = kernel.subscribe((newState) => {
      if (mounted) {
        setState(newState);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [kernel]);

  // Submit input
  const submitInput = useCallback(
    async (text: string, source: 'speech' | 'text' = 'text'): Promise<InputResult> => {
      return kernel.submitInput(text, source);
    },
    [kernel]
  );

  // Start new session
  const startNewSession = useCallback(async () => {
    return kernel.startNewSession();
  }, [kernel]);

  return {
    // State
    isInitialized,
    isProcessing: state.isProcessing,
    currentSession: state.currentSession,
    queueLength: state.queueLength,

    // Actions
    submitInput,
    startNewSession,
  };
}
