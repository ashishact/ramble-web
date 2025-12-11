/**
 * Long-Term Memory Panel
 *
 * Shows consolidated long-term memory claims.
 * These are stable, high-value claims promoted from working memory.
 */

import { MemoryClaimCard } from './MemoryClaimCard';
import { formatRelativeTime } from '@/program/utils/time';
import type { Claim } from '@/program';

interface LongTermMemoryPanelProps {
  claims: Claim[];
  onClaimClick?: (claim: Claim) => void;
}

export function LongTermMemoryPanel({ claims, onClaimClick }: LongTermMemoryPanelProps) {
  // Filter long-term memory claims and sort by promoted date (most recent first)
  const ltmClaims = claims
    .filter((c) => c.memory_tier === 'long_term' && c.state === 'active')
    .sort((a, b) => (b.promoted_at || 0) - (a.promoted_at || 0));

  // Group by recency
  const recentlyPromoted = ltmClaims.filter((c) => {
    if (!c.promoted_at) return false;
    const daysSincePromotion = (Date.now() - c.promoted_at) / (24 * 60 * 60 * 1000);
    return daysSincePromotion < 7;
  });

  const established = ltmClaims.filter((c) => {
    if (!c.promoted_at) return true;
    const daysSincePromotion = (Date.now() - c.promoted_at) / (24 * 60 * 60 * 1000);
    return daysSincePromotion >= 7;
  });

  if (ltmClaims.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        <p>No items in long-term memory yet</p>
        <p className="text-xs mt-2">
          Claims are promoted based on high salience, confirmation, and stability
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      <div className="stats stats-horizontal shadow bg-base-200">
        <div className="stat">
          <div className="stat-title text-xs">Total LTM</div>
          <div className="stat-value text-2xl">{ltmClaims.length}</div>
          <div className="stat-desc">Consolidated items</div>
        </div>
        <div className="stat">
          <div className="stat-title text-xs">Recently Promoted</div>
          <div className="stat-value text-2xl text-primary">{recentlyPromoted.length}</div>
          <div className="stat-desc">Last 7 days</div>
        </div>
        <div className="stat">
          <div className="stat-title text-xs">Avg Confidence</div>
          <div className="stat-value text-2xl">
            {Math.round((ltmClaims.reduce((sum, c) => sum + c.current_confidence, 0) / ltmClaims.length) * 100)}%
          </div>
          <div className="stat-desc">High stability</div>
        </div>
      </div>

      {/* Recently Promoted */}
      {recentlyPromoted.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <span className="badge badge-primary badge-sm">New</span>
              Recently Promoted ({recentlyPromoted.length})
            </h3>
          </div>
          <div className="space-y-2">
            {recentlyPromoted.map((claim) => (
              <div key={claim.id} className="space-y-1">
                <MemoryClaimCard
                  claim={claim}
                  onClick={() => onClaimClick?.(claim)}
                  showSalience={true}
                />
                {claim.promotedAt && (
                  <div className="text-xs opacity-40 ml-3">
                    Promoted {formatRelativeTime(claim.promotedAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Established LTM */}
      {established.length > 0 && (
        <div>
          {recentlyPromoted.length > 0 && (
            <div className="divider text-xs opacity-50">Established Memory</div>
          )}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              Established ({established.length})
            </h3>
            <span className="text-xs opacity-50">
              Stable and consolidated
            </span>
          </div>
          <div className="space-y-2">
            {established.map((claim) => (
              <MemoryClaimCard
                key={claim.id}
                claim={claim}
                onClick={() => onClaimClick?.(claim)}
                showSalience={true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
