/**
 * Extractors & Observers Management Tab
 *
 * Allows viewing and enabling/disabling extractors and observers
 */

import { useState } from 'react';
import type { ExtractionProgramRecord, DispatcherStats } from '@/program';

interface ExtractorsObserversTabProps {
  extractors: ExtractionProgramRecord[];
  observers: Array<{ type: string; name: string; description: string; active: boolean }>;
  observerStats: DispatcherStats | null;
  onToggleExtractor: (id: string, active: boolean) => void;
  onToggleObserver: (type: string, active: boolean) => void;
}

type SubTab = 'extractors' | 'observers';

export function ExtractorsObserversTab({
  extractors,
  observers,
  observerStats,
  onToggleExtractor,
  onToggleObserver,
}: ExtractorsObserversTabProps) {
  const [subTab, setSubTab] = useState<SubTab>('extractors');

  const activeExtractors = extractors.filter(e => e.active);
  const inactiveExtractors = extractors.filter(e => !e.active);

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab navigation */}
      <div className="tabs tabs-boxed bg-base-200">
        <button
          className={`tab ${subTab === 'extractors' ? 'tab-active' : ''}`}
          onClick={() => setSubTab('extractors')}
        >
          Extractors ({extractors.length})
        </button>
        <button
          className={`tab ${subTab === 'observers' ? 'tab-active' : ''}`}
          onClick={() => setSubTab('observers')}
        >
          Observers ({observers.length})
        </button>
      </div>

      {/* Extractors view */}
      {subTab === 'extractors' && (
        <div className="flex flex-col gap-4">
          {/* Stats */}
          <div className="stats stats-vertical lg:stats-horizontal shadow">
            <div className="stat">
              <div className="stat-title">Total Extractors</div>
              <div className="stat-value text-2xl">{extractors.length}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Active</div>
              <div className="stat-value text-2xl text-success">{activeExtractors.length}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Disabled</div>
              <div className="stat-value text-2xl text-base-content/50">{inactiveExtractors.length}</div>
            </div>
          </div>

          {/* Active extractors */}
          {activeExtractors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold opacity-50 mb-2">Active Extractors</h3>
              <div className="flex flex-col gap-2">
                {activeExtractors.map(extractor => (
                  <ExtractorCard
                    key={extractor.id}
                    extractor={extractor}
                    onToggle={onToggleExtractor}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Disabled extractors */}
          {inactiveExtractors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold opacity-50 mb-2">Disabled Extractors</h3>
              <div className="flex flex-col gap-2 opacity-60">
                {inactiveExtractors.map(extractor => (
                  <ExtractorCard
                    key={extractor.id}
                    extractor={extractor}
                    onToggle={onToggleExtractor}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Observers view */}
      {subTab === 'observers' && (
        <div className="flex flex-col gap-4">
          {/* Stats */}
          {observerStats && (
            <div className="stats stats-vertical lg:stats-horizontal shadow">
              <div className="stat">
                <div className="stat-title">Total Runs</div>
                <div className="stat-value text-2xl">{observerStats.totalObserverRuns}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Events Processed</div>
                <div className="stat-value text-2xl">{observerStats.totalEvents}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Avg Time (ms)</div>
                <div className="stat-value text-2xl">{Math.round(observerStats.averageProcessingTimeMs)}</div>
              </div>
            </div>
          )}

          {/* Observer list */}
          <div className="flex flex-col gap-2">
            {observers.map(observer => (
              <ObserverCard
                key={observer.type}
                observer={observer}
                stats={observerStats}
                onToggle={onToggleObserver}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Extractor Card Component
 */
interface ExtractorCardProps {
  extractor: ExtractionProgramRecord;
  onToggle: (id: string, active: boolean) => void;
}

function ExtractorCard({ extractor, onToggle }: ExtractorCardProps) {
  const successRate = extractor.runCount > 0
    ? Math.round(extractor.successRate * 100)
    : 0;

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold">{extractor.name}</h4>
              {extractor.isCore && (
                <span className="badge badge-sm badge-primary">core</span>
              )}
              <span className="badge badge-sm badge-ghost">{extractor.type}</span>
            </div>
            <p className="text-sm opacity-70 mt-1">v{extractor.version}</p>

            {/* Stats */}
            <div className="flex gap-4 mt-2 text-xs">
              <div>
                <span className="opacity-50">Runs:</span> {extractor.runCount}
              </div>
              <div>
                <span className="opacity-50">Success:</span>{' '}
                <span className={successRate >= 80 ? 'text-success' : successRate >= 50 ? 'text-warning' : 'text-error'}>
                  {successRate}%
                </span>
              </div>
            </div>
          </div>

          {/* Toggle */}
          <div className="form-control">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-xs">{extractor.active ? 'ON' : 'OFF'}</span>
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-success"
                checked={extractor.active}
                onChange={(e) => onToggle(extractor.id, e.target.checked)}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Observer Card Component
 */
interface ObserverCardProps {
  observer: { type: string; name: string; description: string; active: boolean };
  stats: DispatcherStats | null;
  onToggle: (type: string, active: boolean) => void;
}

function ObserverCard({ observer, stats, onToggle }: ObserverCardProps) {
  const runCount = stats?.observerRunsByType[observer.type] || 0;

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold">{observer.name}</h4>
              <span className="badge badge-sm badge-ghost">{observer.type}</span>
            </div>
            <p className="text-sm opacity-70 mt-1">{observer.description}</p>

            {/* Stats */}
            <div className="flex gap-4 mt-2 text-xs">
              <div>
                <span className="opacity-50">Runs:</span> {runCount}
              </div>
            </div>
          </div>

          {/* Toggle */}
          <div className="form-control">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-xs">{observer.active ? 'ON' : 'OFF'}</span>
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-success"
                checked={observer.active}
                onChange={(e) => onToggle(observer.type, e.target.checked)}
                disabled={!observer.active} // Can only disable, not re-enable
                title={!observer.active ? 'Re-enabling observers requires restart' : ''}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
