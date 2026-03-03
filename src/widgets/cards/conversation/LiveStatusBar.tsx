/**
 * LiveStatusBar — User-friendly pipeline status indicator
 *
 * Shows friendly labels for pipeline steps:
 *   input   → "Listening..."
 *   save    → "Saving..."
 *   process → "Understanding your input..."
 *   done    → auto-hide after 3s
 *
 * Thin strip with subtle background and pulsing dot while running.
 */

import { useState, useEffect, useRef } from 'react';
import type { PipelineState, StepId } from '../../../program/kernel/pipelineStatus';

interface LiveStatusBarProps {
  pipelineState: PipelineState;
}

const FRIENDLY_LABELS: Record<StepId, string> = {
  input: 'Listening...',
  save: 'Saving...',
  process: 'Understanding your input...',
  done: '',
};

const AUTO_HIDE_DELAY = 3000;

export function LiveStatusBar({ pipelineState }: LiveStatusBarProps) {
  const [visible, setVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (pipelineState.isRunning) {
      setVisible(true);
    } else if (pipelineState.steps.length > 0) {
      // Auto-hide after delay when pipeline completes
      hideTimeoutRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_DELAY);
    }

    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [pipelineState.isRunning, pipelineState.steps.length]);

  if (!visible || pipelineState.steps.length === 0) return null;

  // Find the current running step for the friendly label
  const runningStep = pipelineState.steps.find((s) => s.status === 'running');
  const friendlyLabel = runningStep ? FRIENDLY_LABELS[runningStep.id] : '';

  // If pipeline is done and still visible (during auto-hide delay), show nothing
  if (!pipelineState.isRunning && !friendlyLabel) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-base-200/50 rounded-lg
                 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/* Pulsing dot */}
      {pipelineState.isRunning && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
      )}

      {/* Friendly status label */}
      {friendlyLabel && (
        <span className="text-xs text-base-content/50">{friendlyLabel}</span>
      )}

      {/* Step indicators */}
      <div className="flex items-center gap-1 ml-auto">
        {pipelineState.steps
          .filter((s) => s.id !== 'done')
          .map((step) => (
            <span
              key={step.id}
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-200 ${
                step.status === 'running'
                  ? 'bg-primary animate-pulse'
                  : step.status === 'success'
                  ? 'bg-success/50'
                  : step.status === 'error'
                  ? 'bg-error/50'
                  : 'bg-base-content/15'
              }`}
              title={`${step.label}: ${step.status}`}
            />
          ))}
      </div>
    </div>
  );
}
