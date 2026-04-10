/**
 * useKernel Hook
 *
 * React hook for interacting with the kernel
 */

import { useState, useEffect, useCallback } from 'react';
import { getKernel, type KernelState, type InputResult, type QuickResultInput } from '../kernel';

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
    async (
      text: string,
      source: 'speech' | 'text' = 'text',
      recordingId?: string
    ): Promise<InputResult> => {
      return kernel.submitInput(text, source, recordingId);
    },
    [kernel]
  );

  const saveUserTurn = useCallback(
    async (transcript: string, sessionId: string, source: 'typed' | 'speech' = 'typed', recordingId?: string): Promise<string> => {
      return kernel.saveUserTurn(transcript, sessionId, source, recordingId);
    },
    [kernel]
  );

  const ingestQuickResult = useCallback(
    async (input: QuickResultInput, existingUserConvId?: string): Promise<void> => {
      return kernel.ingestQuickResult(input.transcript, input.quickResponse, input.sessionId, input.recordingId, existingUserConvId);
    },
    [kernel]
  );

  return {
    // State
    isInitialized,
    isProcessing: state.isProcessing,
    queueLength: state.queueLength,

    // Actions
    submitInput,
    saveUserTurn,
    ingestQuickResult,
  };
}
