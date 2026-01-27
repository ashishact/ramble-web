/**
 * TranscriptReview - Three-panel overlay for reviewing/correcting STT transcript
 *
 * Layout:
 * - Left: Editable source text with word highlighting
 * - Middle: Correction mappings (original → replacement)
 * - Right: Preview with corrections applied (green highlights)
 *
 * Features:
 * - Auto-suggests corrections based on:
 *   1. Learned corrections (from previous user edits) with context matching
 *   2. Entity matching using phonetic algorithms (fallback)
 * - Learns from user edits: computes diff on submit and stores corrections
 * - Shows confidence scores based on context match and usage count
 * - Click on left panel word to see context
 * - Enter: Submit corrected text
 * - Escape: Cancel
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { entityStore, learnedCorrectionStore } from '../db/stores';
import {
  analyzeText,
  applyCorrections,
  computeWordDiff,
  type WordCorrection,
} from '../services/phoneticMatcher';
import { ArrowRight, Check, Brain, Sparkles, Pencil, Mic } from 'lucide-react';

/**
 * Ramble metadata from clipboard (compact format)
 *
 * HTML format:
 *   <span data-ramble='{"s":"ramble","v":"1.9","ts":1706367000000,"t":"t","d":5.2}'>Hello world</span>
 *
 * Keys:
 *   s   - source (always "ramble")
 *   v   - version
 *   ts  - timestamp (unix ms)
 *   t   - type: "t"=transcription, "x"=transformation
 *   d   - duration in seconds (optional)
 */
export interface RambleMetadata {
  source: string;  // e.g., 'ramble', 'whisper', etc.
  version: string;
  timestamp: number;  // unix ms
  type: 'transcription' | 'transformation';
  duration?: number;
}

interface TranscriptReviewProps {
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  rambleMetadata?: RambleMetadata | null;
}

interface EntityData {
  name: string;
  type: string;
  aliases: string[];
}

// Extended correction with source info
interface ExtendedCorrection extends WordCorrection {
  source: 'learned' | 'entity' | 'edit';  // Where the suggestion came from
  confidence?: number;           // For learned corrections
  contextScore?: number;         // How well context matches
}

// Live edit detected from diff
interface LiveEdit {
  original: string;
  corrected: string;
  leftContext: string[];
  rightContext: string[];
}

export function TranscriptReview({ initialText, onSubmit, onCancel, rambleMetadata }: TranscriptReviewProps) {
  // Keep original text for diff computation on submit
  const originalTextRef = useRef(initialText);
  const [text, setText] = useState(initialText);
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [corrections, setCorrections] = useState<ExtendedCorrection[]>([]);
  const [activeCorrections, setActiveCorrections] = useState<Set<number>>(new Set());
  const [focusedWordIndex, setFocusedWordIndex] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live edits - computed from diff between original and current text
  const [liveEdits, setLiveEdits] = useState<LiveEdit[]>([]);
  // Track which edits should be learned (enabled by default)
  const [activeEdits, setActiveEdits] = useState<Set<number>>(new Set());

  // Load entities on mount
  useEffect(() => {
    const loadEntities = async () => {
      const allEntities = await entityStore.getAll();
      setEntities(
        allEntities.map((e) => ({
          name: e.name,
          type: e.type,
          aliases: e.aliasesParsed,
        }))
      );
    };
    loadEntities();
  }, []);

  // Compute live diff as user edits
  useEffect(() => {
    const original = originalTextRef.current;
    if (text === original) {
      setLiveEdits([]);
      setActiveEdits(new Set());
      return;
    }

    // Compute word-level diff
    const changes = computeWordDiff(original, text);
    setLiveEdits(changes);

    // Auto-enable all edits by default
    setActiveEdits(new Set(changes.map((_, i) => i)));
  }, [text]);

  // Analyze text when it changes or entities load
  // Combines learned corrections (priority) and entity matching (fallback)
  useEffect(() => {
    const analyzeWithLearned = async () => {
      // First, get learned corrections for this text
      const learnedResults = await learnedCorrectionStore.findCorrectionsForText(text);

      // Convert learned results to ExtendedCorrection format
      const learnedCorrections: ExtendedCorrection[] = learnedResults.map((r) => ({
        original: r.original,
        replacement: r.corrected,
        matchedAs: r.corrected,
        startIndex: r.startIndex,
        endIndex: r.endIndex,
        entityType: 'learned',
        similarity: r.combinedScore,
        source: 'learned' as const,
        confidence: r.confidence,
        contextScore: r.contextScore,
      }));

      // Get positions covered by learned corrections
      const learnedPositions = new Set<number>();
      learnedCorrections.forEach((c) => {
        for (let i = c.startIndex; i < c.endIndex; i++) {
          learnedPositions.add(i);
        }
      });

      // Get entity-based corrections (only for positions not covered by learned)
      let entityCorrections: ExtendedCorrection[] = [];
      if (entities.length > 0) {
        const rawEntityCorrections = analyzeText(text, entities, 0.65);
        entityCorrections = rawEntityCorrections
          .filter((c) => !learnedPositions.has(c.startIndex))
          .map((c) => ({
            ...c,
            source: 'entity' as const,
          }));
      }

      // Combine: learned first (higher priority), then entity
      const allCorrections = [...learnedCorrections, ...entityCorrections];
      allCorrections.sort((a, b) => a.startIndex - b.startIndex);

      setCorrections(allCorrections);

      // Auto-enable based on source and confidence
      const autoEnabled = new Set<number>();
      allCorrections.forEach((c, i) => {
        if (c.source === 'learned') {
          // Auto-enable learned corrections with high context match
          if ((c.contextScore ?? 0) >= 0.5) {
            autoEnabled.add(i);
          }
        } else if (c.similarity >= 0.85) {
          // Auto-enable high-confidence entity matches
          autoEnabled.add(i);
        }
      });
      setActiveCorrections(autoEnabled);
    };

    analyzeWithLearned();
  }, [text, entities]);

  // Focus textarea on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Find which word the cursor is on
  useEffect(() => {
    const wordRegex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
    let match;
    let foundIndex: number | null = null;

    while ((match = wordRegex.exec(text)) !== null) {
      if (cursorPosition >= match.index && cursorPosition <= match.index + match[0].length) {
        // Find if this word has a correction
        const correctionIndex = corrections.findIndex(
          (c) => c.startIndex === match!.index
        );
        if (correctionIndex !== -1) {
          foundIndex = correctionIndex;
        }
        break;
      }
    }

    setFocusedWordIndex(foundIndex);
  }, [cursorPosition, text, corrections]);

  // Toggle a correction
  const toggleCorrection = useCallback((index: number) => {
    setActiveCorrections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Toggle whether an edit should be learned
  const toggleEdit = useCallback((index: number) => {
    setActiveEdits((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Get corrected text based on active corrections
  const correctedText = useMemo(() => {
    const activeList = corrections.filter((_, i) => activeCorrections.has(i));
    return applyCorrections(text, activeList);
  }, [text, corrections, activeCorrections]);

  // Learn from user edits and submit
  const handleSubmit = useCallback(async () => {
    const finalText = correctedText.trim();
    if (!finalText) return;

    // Only learn edits that are enabled (user didn't disable them)
    const editsToLearn = liveEdits.filter((_, i) => activeEdits.has(i));

    // Store each enabled edit as a learned correction
    for (const change of editsToLearn) {
      console.log('[TranscriptReview] Learning correction:', change.original, '→', change.corrected);
      await learnedCorrectionStore.learn({
        original: change.original,
        corrected: change.corrected,
        leftContext: change.leftContext,
        rightContext: change.rightContext,
      });
    }

    if (editsToLearn.length > 0) {
      console.log(`[TranscriptReview] Learned ${editsToLearn.length} correction(s)`);
    }

    onSubmit(finalText);
  }, [correctedText, liveEdits, activeEdits, onSubmit]);

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }
    },
    [handleSubmit, onCancel]
  );

  // Handle cursor position change
  const handleSelect = useCallback(() => {
    if (textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart);
    }
  }, []);

  // Handle click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCancel();
      }
    },
    [onCancel]
  );

  // Render the preview text with highlights
  // Green = applied corrections, Blue = user edits
  const renderPreview = () => {
    // Get active corrections
    const activeCorrectionslist = corrections
      .map((c, i) => ({ ...c, index: i }))
      .filter((c) => activeCorrections.has(c.index))
      .sort((a, b) => a.startIndex - b.startIndex);

    // If we have active corrections, highlight them in the text
    if (activeCorrectionslist.length > 0) {
      const parts: React.ReactNode[] = [];
      let lastEnd = 0;

      activeCorrectionslist.forEach((correction, i) => {
        if (correction.startIndex > lastEnd) {
          parts.push(
            <span key={`text-${i}`} className="text-slate-600">
              {text.slice(lastEnd, correction.startIndex)}
            </span>
          );
        }
        parts.push(
          <span
            key={`correction-${i}`}
            className="text-emerald-600 font-medium bg-emerald-50 px-0.5 rounded"
          >
            {correction.replacement}
          </span>
        );
        lastEnd = correction.endIndex;
      });

      if (lastEnd < text.length) {
        parts.push(
          <span key="text-end" className="text-slate-600">
            {text.slice(lastEnd)}
          </span>
        );
      }

      return <>{parts}</>;
    }

    // If only live edits, highlight the corrected words in blue
    if (hasLiveEdits) {
      // Find positions of edited words in current text
      const editedWords = new Set(liveEdits.map(e => e.corrected.toLowerCase()));
      const wordRegex = /([a-zA-Z]+(?:'[a-zA-Z]+)?)/g;

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[1];
        const start = match.index;

        // Add text before this word
        if (start > lastIndex) {
          parts.push(
            <span key={`pre-${start}`} className="text-slate-600">
              {text.slice(lastIndex, start)}
            </span>
          );
        }

        // Check if this word (or phrase containing it) is an edit
        const isEdit = editedWords.has(word.toLowerCase()) ||
          liveEdits.some(e =>
            e.corrected.toLowerCase().split(/\s+/).includes(word.toLowerCase())
          );

        if (isEdit) {
          parts.push(
            <span
              key={`word-${start}`}
              className="text-blue-600 font-medium bg-blue-50 px-0.5 rounded"
            >
              {word}
            </span>
          );
        } else {
          parts.push(
            <span key={`word-${start}`} className="text-slate-600">
              {word}
            </span>
          );
        }

        lastIndex = start + word.length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(
          <span key="end" className="text-slate-600">
            {text.slice(lastIndex)}
          </span>
        );
      }

      return <>{parts}</>;
    }

    return <span className="text-slate-600">{text}</span>;
  };

  // Render left panel with underlined corrections
  const renderSourceWithUnderlines = () => {
    if (corrections.length === 0) {
      return text;
    }

    const sorted = [...corrections].sort((a, b) => a.startIndex - b.startIndex);
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    sorted.forEach((correction, i) => {
      // Text before
      if (correction.startIndex > lastEnd) {
        parts.push(
          <span key={`t-${i}`}>{text.slice(lastEnd, correction.startIndex)}</span>
        );
      }

      // The word with underline
      const isActive = activeCorrections.has(corrections.indexOf(correction));
      const isFocused = focusedWordIndex === corrections.indexOf(correction);
      parts.push(
        <span
          key={`w-${i}`}
          className={`
            border-b-2 cursor-pointer transition-colors
            ${isActive ? 'border-emerald-400 text-emerald-700' : 'border-amber-400 text-amber-700'}
            ${isFocused ? 'bg-amber-100' : ''}
          `}
          onClick={() => toggleCorrection(corrections.indexOf(correction))}
        >
          {text.slice(correction.startIndex, correction.endIndex)}
        </span>
      );

      lastEnd = correction.endIndex;
    });

    // Remaining
    if (lastEnd < text.length) {
      parts.push(<span key="end">{text.slice(lastEnd)}</span>);
    }

    return <>{parts}</>;
  };

  const hasCorrections = corrections.length > 0;
  const hasLiveEdits = liveEdits.length > 0;
  const showPanels = hasCorrections || hasLiveEdits;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className={`w-full mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
        showPanels ? 'max-w-6xl' : 'max-w-2xl'
      }`}>
        {/* Ramble metadata bar */}
        {rambleMetadata && (
          <div className="px-4 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-purple-600">
              <Mic size={14} />
              <span className="text-xs font-semibold capitalize">{rambleMetadata.source}</span>
              <span className="text-[10px] text-purple-400">v{rambleMetadata.version}</span>
            </div>
            <div className="h-3 w-px bg-purple-200" />
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="capitalize">{rambleMetadata.type}</span>
              {rambleMetadata.duration && (
                <span>
                  <span className="text-slate-400">Duration:</span>{' '}
                  {rambleMetadata.duration.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        )}

        {/* Panel layout - single or three-panel based on corrections */}
        <div className={`flex ${showPanels ? 'min-h-[300px]' : 'min-h-[150px]'} max-h-[70vh]`}>
          {/* Source Text Panel */}
          <div className={`flex-1 flex flex-col ${showPanels ? 'border-r border-slate-200' : ''}`}>
            {showPanels && (
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-xs font-medium text-slate-500">Original Text</span>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 relative">
              {/* Overlay for visual highlighting (only when corrections exist) */}
              {hasCorrections && (
                <div className="absolute inset-0 p-4 pointer-events-none whitespace-pre-wrap text-base leading-relaxed text-transparent">
                  {renderSourceWithUnderlines()}
                </div>
              )}
              {/* Actual textarea */}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onSelect={handleSelect}
                onClick={handleSelect}
                onKeyUp={handleSelect}
                className="w-full h-full resize-none focus:outline-none text-base leading-relaxed bg-transparent relative z-10"
                style={{ caretColor: 'black' }}
                placeholder="Edit your transcript..."
              />
            </div>
          </div>

          {/* Middle Panel - Corrections & Live Edits */}
          {showPanels && (
            <div className="w-64 border-r border-slate-200 flex flex-col">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {hasLiveEdits && !hasCorrections ? 'Your Edits' : 'Changes'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {hasCorrections ? `${activeCorrections.size}/${corrections.length}` : ''}
                  {hasCorrections && hasLiveEdits ? ' + ' : ''}
                  {hasLiveEdits ? `${liveEdits.length} edit${liveEdits.length > 1 ? 's' : ''}` : ''}
                </span>
              </div>
              <div className="flex-1 overflow-auto p-2">
                <div className="space-y-1">
                  {/* Show suggested corrections */}
                  {corrections.map((correction, index) => {
                    const isActive = activeCorrections.has(index);
                    const isFocused = focusedWordIndex === index;
                    const isAliasMatch = correction.matchedAs !== correction.replacement;
                    const isLearned = correction.source === 'learned';
                    const confidencePct = isLearned && correction.contextScore !== undefined
                      ? Math.round(correction.contextScore * 100)
                      : null;
                    return (
                      <button
                        key={`correction-${index}`}
                        onClick={() => toggleCorrection(index)}
                        className={`
                          w-full px-2 py-1.5 rounded text-left flex flex-col gap-0.5 transition-colors
                          ${isActive ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'}
                          ${isFocused ? 'ring-2 ring-amber-300' : ''}
                        `}
                      >
                        <div className="flex items-center gap-1.5 text-sm">
                          {/* Source indicator */}
                          {isLearned ? (
                            <span title="Learned correction"><Brain size={12} className="text-purple-400 flex-shrink-0" /></span>
                          ) : (
                            <span title="Entity match"><Sparkles size={12} className="text-amber-400 flex-shrink-0" /></span>
                          )}
                          <span className={`truncate ${isActive ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                            {correction.original}
                          </span>
                          <ArrowRight size={12} className="text-slate-300 flex-shrink-0" />
                          <span className={`truncate font-medium ${isActive ? 'text-emerald-600' : 'text-slate-600'}`}>
                            {correction.replacement}
                          </span>
                          <div className="flex-shrink-0 ml-auto flex items-center gap-1">
                            {confidencePct !== null && (
                              <span className={`text-[10px] ${confidencePct >= 50 ? 'text-purple-500' : 'text-slate-400'}`}>
                                {confidencePct}%
                              </span>
                            )}
                            {isActive ? (
                              <Check size={14} className="text-emerald-500" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded border border-slate-300" />
                            )}
                          </div>
                        </div>
                        {isAliasMatch && !isLearned && (
                          <div className="text-[10px] text-slate-400 pl-4">
                            via alias "{correction.matchedAs}"
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {/* Divider if both exist */}
                  {hasCorrections && hasLiveEdits && (
                    <div className="border-t border-slate-200 my-2 pt-1">
                      <span className="text-[10px] text-slate-400">Your edits (will be learned)</span>
                    </div>
                  )}

                  {/* Show live edits */}
                  {liveEdits.map((edit, index) => {
                    const isEnabled = activeEdits.has(index);
                    return (
                      <button
                        key={`edit-${index}`}
                        onClick={() => toggleEdit(index)}
                        className={`
                          w-full px-2 py-1.5 rounded text-left transition-colors
                          ${isEnabled
                            ? 'bg-blue-50 border border-blue-200 hover:bg-blue-100'
                            : 'bg-slate-50 border border-slate-200 hover:bg-slate-100 opacity-60'}
                        `}
                      >
                        <div className="flex items-center gap-1.5 text-sm">
                          <span title={isEnabled ? "Will be learned (click to disable)" : "Won't be learned (click to enable)"}>
                            <Pencil size={12} className={isEnabled ? "text-blue-400" : "text-slate-400"} />
                          </span>
                          <span className={`truncate ${isEnabled ? 'line-through text-slate-400' : 'text-slate-500'}`}>
                            {edit.original}
                          </span>
                          <ArrowRight size={12} className="text-slate-300 flex-shrink-0" />
                          <span className={`truncate font-medium ${isEnabled ? 'text-blue-600' : 'text-slate-500'}`}>
                            {edit.corrected}
                          </span>
                          <div className="flex-shrink-0 ml-auto">
                            {isEnabled ? (
                              <Check size={14} className="text-blue-500" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded border border-slate-300" />
                            )}
                          </div>
                        </div>
                        {!isEnabled && (
                          <div className="text-[10px] text-slate-400 pl-4 mt-0.5">
                            won't be learned
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Right Panel - Preview */}
          {showPanels && (
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                <span className="text-xs font-medium text-slate-500">Preview</span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="text-base leading-relaxed whitespace-pre-wrap">
                  {renderPreview()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">
              Enter
            </kbd>{' '}
            to submit
            <span className="mx-2">|</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">
              Shift+Enter
            </kbd>{' '}
            new line
            <span className="mx-2">|</span>
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-mono">
              Esc
            </kbd>{' '}
            cancel
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-200 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-3 py-1 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Global state for showing the transcript review
type TranscriptCallback = (text: string) => void;

let showReviewFn: ((text: string, onSubmit: TranscriptCallback, metadata?: RambleMetadata | null) => void) | null = null;

export function registerTranscriptReview(fn: (text: string, onSubmit: TranscriptCallback, metadata?: RambleMetadata | null) => void) {
  showReviewFn = fn;
}

export function showTranscriptReview(text: string, onSubmit: TranscriptCallback, metadata?: RambleMetadata | null) {
  if (showReviewFn) {
    showReviewFn(text, onSubmit, metadata);
  } else {
    // Fallback: directly submit if review not registered
    console.warn('[TranscriptReview] Not registered, submitting directly');
    onSubmit(text);
  }
}
