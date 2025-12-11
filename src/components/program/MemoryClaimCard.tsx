/**
 * Memory Claim Card
 *
 * Enhanced claim card showing salience, memory tier, and temporal info.
 */

import { SalienceIndicator } from './SalienceIndicator';
import type { Claim } from '@/program';
import { formatRelativeTime } from '@/program/utils/time';

interface MemoryClaimCardProps {
  claim: Claim;
  onClick?: () => void;
  showSalience?: boolean;
}

const CLAIM_TYPE_COLORS: Record<string, string> = {
  factual: 'badge-info',
  belief: 'badge-primary',
  intention: 'badge-secondary',
  goal: 'badge-success',
  concern: 'badge-error',
  question: 'badge-warning',
  emotion: 'badge-accent',
  value: 'badge-primary',
  decision: 'badge-info',
  commitment: 'badge-success',
  learning: 'badge-info',
  habit: 'badge-neutral',
  memory_reference: 'badge-ghost',
};

export function MemoryClaimCard({
  claim,
  onClick,
  showSalience = true
}: MemoryClaimCardProps) {
  const isHighSalience = claim.salience > 0.7;
  const isDecaying = claim.temporality !== 'eternal' && claim.state === 'active';

  return (
    <div
      className={`p-3 rounded-lg cursor-pointer transition-all ${
        isHighSalience
          ? 'bg-primary/10 border border-primary/30 hover:bg-primary/20'
          : 'bg-base-200 hover:bg-base-300'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm break-words">{claim.statement}</p>

          {/* Metadata badges */}
          <div className="flex flex-wrap gap-1 mt-2">
            <span className={`badge badge-xs ${CLAIM_TYPE_COLORS[claim.claim_type] || 'badge-ghost'}`}>
              {claim.claim_type}
            </span>
            <span className="badge badge-xs badge-outline">{claim.subject}</span>

            {claim.memory_tier === 'long_term' && (
              <span className="badge badge-xs badge-success">LTM</span>
            )}

            {isDecaying && (
              <span className="badge badge-xs badge-ghost">
                {claim.temporality.replace('_', ' ')}
              </span>
            )}

            {claim.stakes !== 'medium' && (
              <span className={`badge badge-xs ${
                claim.stakes === 'high' || claim.stakes === 'existential'
                  ? 'badge-error'
                  : claim.stakes === 'low'
                  ? 'badge-ghost'
                  : 'badge-warning'
              }`}>
                {claim.stakes}
              </span>
            )}
          </div>
        </div>

        {/* Salience and stats */}
        {showSalience && (
          <div className="flex flex-col items-end gap-1">
            <SalienceIndicator salience={claim.salience} size="sm" />
            <div className="text-xs opacity-50">
              {Math.round(claim.current_confidence * 100)}% conf
            </div>
            {claim.last_confirmed && (
              <div className="text-xs opacity-40">
                {formatRelativeTime(claim.last_confirmed)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
