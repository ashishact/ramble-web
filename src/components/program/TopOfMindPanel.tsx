/**
 * Top of Mind Panel
 *
 * Shows aggregated view of most salient items across categories:
 * - Active Topics (by subject)
 * - Salient Entities
 * - Active Concerns
 * - Open Questions
 */

import { SalienceIndicator } from './SalienceIndicator';
import type { TopOfMind } from '@/program';

interface TopOfMindPanelProps {
  topOfMind: TopOfMind | null;
  onItemClick?: (claimId: string) => void;
}

export function TopOfMindPanel({ topOfMind, onItemClick }: TopOfMindPanelProps) {
  if (!topOfMind) {
    return (
      <div className="text-center py-8 text-base-content/50">
        Loading top of mind...
      </div>
    );
  }

  const hasContent =
    topOfMind.topics.length > 0 ||
    topOfMind.entities.length > 0 ||
    topOfMind.concerns.length > 0 ||
    topOfMind.openQuestions.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-8 text-base-content/50">
        No items in working memory yet
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Active Topics */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-sm">Active Topics</h3>
          {topOfMind.topics.length === 0 ? (
            <p className="text-xs opacity-50">No active topics</p>
          ) : (
            <div className="space-y-2">
              {topOfMind.topics.slice(0, 5).map((topic) => (
                <div key={topic.topic} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{topic.topic}</p>
                    <p className="text-xs opacity-50">{topic.claimCount} claims</p>
                  </div>
                  <SalienceIndicator salience={topic.salience} size="sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Salient Entities */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-sm">Salient Entities</h3>
          {topOfMind.entities.length === 0 ? (
            <p className="text-xs opacity-50">No tracked entities</p>
          ) : (
            <div className="space-y-2">
              {topOfMind.entities.slice(0, 5).map((entity) => (
                <div
                  key={entity.entity}
                  className="flex items-center justify-between gap-2 cursor-pointer hover:bg-base-300 p-1 rounded transition-colors"
                  onClick={() => entity.entityId && onItemClick?.(entity.entityId)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entity.entity}</p>
                    <p className="text-xs opacity-50">
                      {entity.mentionCount} mentions • {entity.entityType}
                    </p>
                  </div>
                  <SalienceIndicator salience={entity.salience} size="sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Concerns */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-sm">Active Concerns</h3>
          {topOfMind.concerns.length === 0 ? (
            <p className="text-xs opacity-50">No active concerns</p>
          ) : (
            <div className="space-y-2">
              {topOfMind.concerns.slice(0, 5).map((concern) => (
                <div
                  key={concern.claimId}
                  className="p-2 rounded hover:bg-base-300 cursor-pointer transition-colors"
                  onClick={() => onItemClick?.(concern.claimId)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm flex-1">{concern.concern}</p>
                    <SalienceIndicator salience={concern.salience} size="sm" />
                  </div>
                  <div className="flex gap-1 mt-1">
                    <span className={`badge badge-xs ${
                      concern.stakes === 'high' || concern.stakes === 'existential'
                        ? 'badge-error'
                        : 'badge-warning'
                    }`}>
                      {concern.stakes}
                    </span>
                    {concern.emotionalIntensity > 0.6 && (
                      <span className="badge badge-xs badge-accent">
                        emotional
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Open Questions */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-sm">Open Questions</h3>
          {topOfMind.openQuestions.length === 0 ? (
            <p className="text-xs opacity-50">No open questions</p>
          ) : (
            <div className="space-y-2">
              {topOfMind.openQuestions.slice(0, 5).map((question) => (
                <div
                  key={question.claimId}
                  className="p-2 rounded hover:bg-base-300 cursor-pointer transition-colors"
                  onClick={() => onItemClick?.(question.claimId)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm flex-1">{question.question}</p>
                    <SalienceIndicator salience={question.salience} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
