/**
 * PipelineStatus - Lightweight pipeline execution tracker
 *
 * @deprecated Widgets should subscribe to eventBus events instead:
 *   - `processing:system-i`  → System I (per-chunk) processing complete
 *   - `processing:system-ii` → System II (full recording) processing complete
 *   - `processing:consolidation` → Consolidation pass complete
 *
 * This module is still functional and used by PipelineBreadcrumb and
 * ConversationList for backward compatibility. It will be removed once
 * those components migrate to eventBus subscriptions.
 *
 * Tracks high-level steps only. Keeps last run visible until next starts.
 */

export type StepId = 'input' | 'save' | 'process' | 'done';
export type StepStatus = 'pending' | 'running' | 'success' | 'error';

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
}

export interface PipelineState {
  steps: Step[];
  isRunning: boolean;
}

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'input', label: 'Input' },
  { id: 'save', label: 'Save' },
  { id: 'process', label: 'Process' },
  { id: 'done', label: 'Done' },
];

class PipelineStatus {
  private static instance: PipelineStatus;
  private state: PipelineState = { steps: [], isRunning: false };
  private listeners = new Set<(state: PipelineState) => void>();

  static getInstance(): PipelineStatus {
    if (!this.instance) this.instance = new PipelineStatus();
    return this.instance;
  }

  private reset(): void {
    this.state = {
      steps: STEPS.map((s) => ({ ...s, status: 'pending' as StepStatus })),
      isRunning: true,
    };
  }

  start(): void {
    this.reset();
    this.notify();
  }

  step(id: StepId, status: StepStatus): void {
    const stepIndex = this.state.steps.findIndex((s) => s.id === id);
    if (stepIndex >= 0) {
      // Create new state object for React to detect changes
      this.state = {
        steps: this.state.steps.map((s, i) =>
          i === stepIndex ? { ...s, status } : s
        ),
        isRunning: id === 'done' ? false : this.state.isRunning,
      };
      this.notify();
    }
  }

  getState(): PipelineState {
    return this.state;
  }

  subscribe(fn: (state: PipelineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const state = this.state;
    this.listeners.forEach((fn) => fn(state));
  }
}

export const pipelineStatus = PipelineStatus.getInstance();
