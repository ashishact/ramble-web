/**
 * PipelineBreadcrumb - Shows pipeline execution status in the header
 *
 * Auto-hides 5 seconds after pipeline completes (if no new pipeline starts)
 */

import { useState, useEffect, useRef } from 'react';
import { pipelineStatus, type PipelineState, type StepStatus } from '../program/kernel/pipelineStatus';
import { Check, X, Loader2, Circle } from 'lucide-react';

const statusIcon = (status: StepStatus) => {
  switch (status) {
    case 'running':
      return <Loader2 size={10} className="animate-spin text-info" />;
    case 'success':
      return <Check size={10} className="text-success" />;
    case 'error':
      return <X size={10} className="text-error" />;
    default:
      return <Circle size={8} className="text-base-content/30" />;
  }
};

const AUTO_HIDE_DELAY = 5000; // 5 seconds

export function PipelineBreadcrumb() {
  const [state, setState] = useState<PipelineState>(pipelineStatus.getState());
  const [isVisible, setIsVisible] = useState(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return pipelineStatus.subscribe(setState);
  }, []);

  // Auto-hide logic: hide 5s after pipeline completes, cancel if new pipeline starts
  useEffect(() => {
    // Clear any existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (state.isRunning) {
      // Pipeline is running - show it
      setIsVisible(true);
    } else if (state.steps.length > 0) {
      // Pipeline finished - start auto-hide timer
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, AUTO_HIDE_DELAY);
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [state.isRunning, state.steps.length]);

  // Don't show if no steps (never run) or hidden
  if (state.steps.length === 0 || !isVisible) return null;

  return (
    <div className="flex items-center gap-1 text-xs">
      {state.steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-base-content/30 mx-0.5">→</span>}
          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
              step.status === 'running'
                ? 'bg-info/10 text-info'
                : step.status === 'success'
                ? 'text-base-content/50'
                : step.status === 'error'
                ? 'bg-error/10 text-error'
                : 'text-base-content/40'
            }`}
          >
            {statusIcon(step.status)}
            <span className="font-medium">{step.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
