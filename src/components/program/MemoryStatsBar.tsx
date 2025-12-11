/**
 * Memory Stats Bar
 *
 * Shows memory system statistics in a grid layout.
 */

import type { MemoryStats } from '@/program';

interface MemoryStatsBarProps {
  stats: MemoryStats;
}

export function MemoryStatsBar({ stats }: MemoryStatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Working Memory */}
      <div className="stat bg-base-200 rounded-lg p-3">
        <div className="stat-title text-xs">Working Memory</div>
        <div className="stat-value text-xl">{stats.workingMemoryCount}</div>
        <div className="stat-desc text-xs">Active items</div>
      </div>

      {/* Long-Term Memory */}
      <div className="stat bg-base-200 rounded-lg p-3">
        <div className="stat-title text-xs">Long-Term</div>
        <div className="stat-value text-xl text-primary">{stats.longTermMemoryCount}</div>
        <div className="stat-desc text-xs">Consolidated</div>
      </div>

      {/* Average Salience */}
      <div className="stat bg-base-200 rounded-lg p-3">
        <div className="stat-title text-xs">Avg Salience</div>
        <div className="stat-value text-xl">
          {(stats.averageSalience * 100).toFixed(0)}%
        </div>
        <progress
          className="progress progress-primary w-full mt-1"
          value={stats.averageSalience * 100}
          max="100"
        />
      </div>

      {/* Memory Health */}
      <div className="stat bg-base-200 rounded-lg p-3">
        <div className="stat-title text-xs">Health</div>
        <div className="flex flex-wrap gap-1 mt-1">
          <span className="badge badge-success badge-sm">
            {stats.highSalienceCount} high
          </span>
          <span className="badge badge-warning badge-sm">
            {stats.staleCount} stale
          </span>
          {stats.dormantCount > 0 && (
            <span className="badge badge-ghost badge-sm">
              {stats.dormantCount} dormant
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
