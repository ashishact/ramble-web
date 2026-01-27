/**
 * LearnedCorrectionsWidget - Manage learned STT corrections
 *
 * Shows all learned corrections with ability to:
 * - View corrections with context and confidence
 * - Edit correction text
 * - Delete unwanted corrections
 *
 * Uses WatermelonDB observable for automatic reactivity.
 */

import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash2, Edit2, Check, X, ArrowRight } from 'lucide-react';
import { learnedCorrectionStore } from '../../db/stores';
import { collections } from '../../db';
import type LearnedCorrection from '../../db/models/LearnedCorrection';

export function LearnedCorrectionsWidget() {
  const [corrections, setCorrections] = useState<LearnedCorrection[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to learned_corrections collection changes
  useEffect(() => {
    setIsLoading(true);

    // Create observable query for all corrections, sorted by createdAt desc
    const subscription = collections.learnedCorrections
      .query()
      .observe()
      .subscribe({
        next: (records) => {
          // Cast and sort by createdAt descending (newest first)
          const typed = records as LearnedCorrection[];
          const sorted = [...typed].sort((a, b) => b.createdAt - a.createdAt);
          setCorrections(sorted);
          setIsLoading(false);
        },
        error: (err) => {
          console.error('Failed to observe corrections:', err);
          setIsLoading(false);
        },
      });

    return () => subscription.unsubscribe();
  }, []);

  // Manual reload (for after edits that create new records)
  const loadCorrections = useCallback(async () => {
    try {
      const all = await learnedCorrectionStore.getAll();
      setCorrections(all);
    } catch (err) {
      console.error('Failed to load corrections:', err);
    }
  }, []);

  // Delete a correction
  const handleDelete = useCallback(async (id: string) => {
    const confirmed = window.confirm('Delete this correction?');
    if (!confirmed) return;

    const success = await learnedCorrectionStore.delete(id);
    if (success) {
      setCorrections((prev) => prev.filter((c) => c.id !== id));
    }
  }, []);

  // Start editing
  const handleStartEdit = useCallback((correction: LearnedCorrection) => {
    setEditingId(correction.id);
    setEditValue(correction.corrected);
  }, []);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  // Save edit (we need to delete and recreate since we can't update the corrected value easily)
  const handleSaveEdit = useCallback(async (correction: LearnedCorrection) => {
    if (!editValue.trim() || editValue === correction.corrected) {
      handleCancelEdit();
      return;
    }

    // Delete old and create new with updated correction
    await learnedCorrectionStore.delete(correction.id);
    await learnedCorrectionStore.learn({
      original: correction.original,
      corrected: editValue.trim(),
      leftContext: correction.leftContextParsed,
      rightContext: correction.rightContextParsed,
    });

    setEditingId(null);
    setEditValue('');
    loadCorrections();
  }, [editValue, handleCancelEdit, loadCorrections]);

  if (isLoading) {
    return (
      <div
        className="h-full flex items-center justify-center text-slate-400"
        data-doc='{"icon":"mdi:school","title":"Learned Corrections","desc":"Auto-learned speech corrections from your edits. When you correct transcripts, the system learns to apply similar fixes automatically."}'
      >
        <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (corrections.length === 0) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:school","title":"Learned Corrections","desc":"Auto-learned speech corrections from your edits. When you correct transcripts, the system learns to apply similar fixes automatically."}'
      >
        <Brain size={32} className="mb-2 opacity-50" />
        <p className="text-sm text-center">No learned corrections yet</p>
        <p className="text-xs text-center mt-1 opacity-75">
          Edit transcripts to teach me your corrections
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      data-doc='{"icon":"mdi:school","title":"Learned Corrections","desc":"Edit or delete corrections. Shows original → corrected mapping, context, confidence %, and usage count."}'
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-purple-500" />
          <span className="text-xs font-medium text-slate-600">Learned Corrections</span>
        </div>
        <span className="text-[10px] text-slate-400">{corrections.length} total</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1.5">
          {corrections.map((correction) => {
            const isEditing = editingId === correction.id;
            const confidencePct = Math.round(correction.confidence * 100);
            const leftCtx = correction.leftContextParsed.join(' ');
            const rightCtx = correction.rightContextParsed.join(' ');

            return (
              <div
                key={correction.id}
                className="p-2 rounded-lg bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors"
              >
                {/* Main row */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-1.5 text-sm min-w-0">
                    <span className="truncate text-slate-500">{correction.original}</span>
                    <ArrowRight size={12} className="text-slate-300 flex-shrink-0" />
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(correction);
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="flex-1 px-1.5 py-0.5 text-sm border border-purple-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
                        autoFocus
                      />
                    ) : (
                      <span className="truncate font-medium text-purple-600">
                        {correction.corrected}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(correction)}
                          className="p-1 hover:bg-emerald-100 rounded transition-colors"
                          title="Save"
                        >
                          <Check size={14} className="text-emerald-500" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                          title="Cancel"
                        >
                          <X size={14} className="text-slate-400" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(correction)}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={14} className="text-slate-400" />
                        </button>
                        <button
                          onClick={() => handleDelete(correction.id)}
                          className="p-1 hover:bg-red-100 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Context & stats row */}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                  {(leftCtx || rightCtx) && (
                    <span className="truncate" title={`Context: ...${leftCtx} [word] ${rightCtx}...`}>
                      ctx: {leftCtx ? `...${leftCtx}` : ''} • {rightCtx ? `${rightCtx}...` : ''}
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0">
                    {confidencePct}% • {correction.count}x used
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
