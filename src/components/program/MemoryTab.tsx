/**
 * Memory Tab
 *
 * Main memory interface with sub-tabs for different views:
 * - Top of Mind: Aggregated salient items
 * - Working Memory: Active working memory claims
 * - Long-Term Memory: Consolidated long-term claims
 */

import { useState } from 'react';
import { MemoryStatsBar } from './MemoryStatsBar';
import { TopOfMindPanel } from './TopOfMindPanel';
import { WorkingMemoryPanel } from './WorkingMemoryPanel';
import { LongTermMemoryPanel } from './LongTermMemoryPanel';
import type { Claim, TopOfMind, MemoryStats } from '@/program';

interface MemoryTabProps {
  workingMemory: Claim[];
  longTermMemory: Claim[];
  topOfMind: TopOfMind | null;
  memoryStats: MemoryStats | null;
  onRecordAccess?: (claimId: string) => void;
}

type MemoryView = 'top-of-mind' | 'working' | 'long-term';

export function MemoryTab({
  workingMemory,
  longTermMemory,
  topOfMind,
  memoryStats,
  onRecordAccess,
}: MemoryTabProps) {
  const [activeView, setActiveView] = useState<MemoryView>('top-of-mind');

  const handleClaimClick = (claim: Claim) => {
    if (onRecordAccess) {
      onRecordAccess(claim.id);
    }
    // TODO: Could open a detail modal here
  };

  const allClaims = [...workingMemory, ...longTermMemory];

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      {memoryStats && (
        <div className="mb-4">
          <MemoryStatsBar stats={memoryStats} />
        </div>
      )}

      {/* Sub-tab Navigation */}
      <div className="tabs tabs-boxed bg-base-200">
        <button
          className={`tab ${activeView === 'top-of-mind' ? 'tab-active' : ''}`}
          onClick={() => setActiveView('top-of-mind')}
        >
          Top of Mind
        </button>
        <button
          className={`tab ${activeView === 'working' ? 'tab-active' : ''}`}
          onClick={() => setActiveView('working')}
        >
          Working Memory
          {workingMemory.length > 0 && (
            <span className="badge badge-sm ml-1">{workingMemory.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeView === 'long-term' ? 'tab-active' : ''}`}
          onClick={() => setActiveView('long-term')}
        >
          Long-Term Memory
          {longTermMemory.length > 0 && (
            <span className="badge badge-sm badge-primary ml-1">{longTermMemory.length}</span>
          )}
        </button>
      </div>

      {/* Active Panel */}
      <div className="min-h-[400px]">
        {activeView === 'top-of-mind' && (
          <TopOfMindPanel
            topOfMind={topOfMind}
            onItemClick={(claimId) => {
              const claim = allClaims.find((c) => c.id === claimId);
              if (claim) handleClaimClick(claim);
            }}
          />
        )}

        {activeView === 'working' && (
          <WorkingMemoryPanel
            claims={workingMemory}
            onClaimClick={handleClaimClick}
          />
        )}

        {activeView === 'long-term' && (
          <LongTermMemoryPanel
            claims={longTermMemory}
            onClaimClick={handleClaimClick}
          />
        )}
      </div>
    </div>
  );
}
