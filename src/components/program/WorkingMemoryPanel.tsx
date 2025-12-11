/**
 * Working Memory Panel
 *
 * Shows all working memory claims sorted by salience.
 * Clicking a claim records access (boosts salience) and shows details.
 */

import { MemoryClaimCard } from './MemoryClaimCard';
import type { Claim } from '@/program';

interface WorkingMemoryPanelProps {
  claims: Claim[];
  onClaimClick?: (claim: Claim) => void;
}

export function WorkingMemoryPanel({ claims, onClaimClick }: WorkingMemoryPanelProps) {
  // Filter and sort by salience
  const workingMemoryClaims = claims
    .filter((c) => c.memory_tier === 'working' && c.state === 'active')
    .sort((a, b) => b.salience - a.salience);

  const staleClaims = claims
    .filter((c) => c.memory_tier === 'working' && c.state === 'stale')
    .sort((a, b) => b.salience - a.salience);

  if (workingMemoryClaims.length === 0 && staleClaims.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        <p>No items in working memory</p>
        <p className="text-xs mt-2">Claims will appear here as they are created</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Working Memory */}
      {workingMemoryClaims.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              Active ({workingMemoryClaims.length})
            </h3>
            <span className="text-xs opacity-50">
              Sorted by salience
            </span>
          </div>
          <div className="space-y-2">
            {workingMemoryClaims.map((claim) => (
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

      {/* Stale Claims */}
      {staleClaims.length > 0 && (
        <div>
          <div className="divider text-xs opacity-50">Stale Claims</div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold opacity-60">
              Stale ({staleClaims.length})
            </h3>
            <span className="text-xs opacity-40">
              Confidence &lt; 20%
            </span>
          </div>
          <div className="space-y-2 opacity-60">
            {staleClaims.map((claim) => (
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
