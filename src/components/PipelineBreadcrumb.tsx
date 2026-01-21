/**
 * PipelineBreadcrumb - Shows pipeline execution status in the header
 */

import { useState, useEffect } from 'react';
import { pipelineStatus, type PipelineState, type StepStatus } from '../program/kernel/pipelineStatus';
import { Check, X, Loader2, Circle } from 'lucide-react';

const statusIcon = (status: StepStatus) => {
  switch (status) {
    case 'running':
      return <Loader2 size={10} className="animate-spin text-blue-500" />;
    case 'success':
      return <Check size={10} className="text-green-500" />;
    case 'error':
      return <X size={10} className="text-red-500" />;
    default:
      return <Circle size={8} className="text-slate-300" />;
  }
};

export function PipelineBreadcrumb() {
  const [state, setState] = useState<PipelineState>(pipelineStatus.getState());

  useEffect(() => {
    return pipelineStatus.subscribe(setState);
  }, []);

  // Don't show if no steps (never run)
  if (state.steps.length === 0) return null;

  return (
    <div className="flex items-center gap-1 text-xs">
      {state.steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300 mx-0.5">→</span>}
          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
              step.status === 'running'
                ? 'bg-blue-50 text-blue-700'
                : step.status === 'success'
                ? 'text-slate-500'
                : step.status === 'error'
                ? 'bg-red-50 text-red-700'
                : 'text-slate-400'
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
