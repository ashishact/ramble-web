/**
 * ExtractionCard — AI extraction results card
 *
 * Shows interleaved below the conversation entry that produced it.
 * Displays:
 * - Memories with type-colored left accents and type badges
 * - All extracted entities with their type labels
 * - All extracted topics
 * Only renders if extraction has memories, entities, or topics.
 */

import type { ProcessingResult } from '../../../program/kernel/processor';

interface ExtractionCardProps {
  extraction: ProcessingResult;
}

// Memory type → color mapping
const MEMORY_COLORS: Record<string, { border: string; badge: string }> = {
  fact:       { border: 'border-l-blue-400',   badge: 'bg-blue-400/15 text-blue-400' },
  belief:     { border: 'border-l-purple-400',  badge: 'bg-purple-400/15 text-purple-400' },
  preference: { border: 'border-l-amber-400',   badge: 'bg-amber-400/15 text-amber-400' },
  concern:    { border: 'border-l-red-400',     badge: 'bg-red-400/15 text-red-400' },
  intention:  { border: 'border-l-green-400',   badge: 'bg-green-400/15 text-green-400' },
  decision:   { border: 'border-l-teal-400',    badge: 'bg-teal-400/15 text-teal-400' },
};

const DEFAULT_COLOR = { border: 'border-l-base-content/30', badge: 'bg-base-content/10 text-base-content/60' };

export function ExtractionCard({ extraction }: ExtractionCardProps) {
  const hasMemories = extraction.memories.length > 0;
  const hasEntities = extraction.entities.length > 0;
  const hasTopics = extraction.topics.length > 0;

  // Skip empty extractions
  if (!hasMemories && !hasEntities && !hasTopics) return null;

  return (
    <div
      className="bg-base-200/40 rounded-lg p-3 mt-2 border border-base-200/60
                 animate-fadeSlideIn"
      style={{ animationDelay: '200ms' }}
    >
      {/* Memories */}
      {hasMemories && (
        <div className="space-y-2">
          {extraction.memories.map((memory) => {
            const colors = MEMORY_COLORS[memory.type] || DEFAULT_COLOR;
            return (
              <div
                key={memory.id}
                className={`border-l-2 ${colors.border} pl-2.5 py-0.5`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm leading-relaxed text-base-content/80 flex-1">
                    {memory.content}
                  </span>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${colors.badge}`}
                  >
                    {memory.type}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Entity and Topic chips */}
      {(hasEntities || hasTopics) && (
        <div className={`flex flex-wrap gap-1.5 ${hasMemories ? 'mt-2.5 pt-2 border-t border-base-200/60' : ''}`}>
          {extraction.entities.map((entity) => (
            <span
              key={entity.id}
              className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-base-content/50"
            >
              {entity.name}
              <span className="text-base-content/25 ml-1">{entity.type}</span>
            </span>
          ))}
          {extraction.topics.map((topic) => (
            <span
              key={topic.id}
              className="text-[10px] px-2 py-0.5 rounded-full bg-base-200/80 text-base-content/50"
            >
              {topic.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
