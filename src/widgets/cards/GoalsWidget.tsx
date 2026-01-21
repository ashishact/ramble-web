import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Goal from '../../db/models/Goal';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Target, CheckCircle2, Settings } from 'lucide-react';
import { GoalManager } from '../../components/v2/GoalManager';

// Muted colors for goal types
const typeColors: Record<string, string> = {
  'short-term': 'text-blue-400/70',
  'long-term': 'text-purple-400/70',
  'recurring': 'text-amber-400/70',
  'milestone': 'text-emerald-400/70',
};

export const GoalsWidget: React.FC<WidgetProps> = () => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showManager, setShowManager] = useState(false);

  useEffect(() => {
    const query = database
      .get<Goal>('goals')
      .query(
        Q.where('status', 'active'),
        Q.sortBy('lastReferenced', Q.desc)
      );

    const subscription = query.observe().subscribe((results) => {
      setGoals(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (goals.length === 0) {
    return (
      <>
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2">
          <Target className="w-5 h-5 mb-1 opacity-40" />
          <span className="text-[10px]">No active goals</span>
        </div>
        {showManager && <GoalManager onClose={() => setShowManager(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="w-full h-full flex flex-col overflow-hidden">
        {/* Header with manage button */}
        <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">{goals.length} active goals</span>
          <button
            onClick={() => setShowManager(true)}
            className="p-0.5 hover:bg-slate-100 rounded transition-colors"
            title="Manage goals"
          >
            <Settings size={12} className="text-slate-400" />
          </button>
        </div>

        {/* Goal list */}
        <div className="flex-1 overflow-auto p-1.5">
          {goals.map((goal, index) => {
            const isOdd = index % 2 === 1;
            const typeColor = typeColors[goal.type] || 'text-slate-400/70';
            return (
              <div
                key={goal.id}
                className={`px-2 py-1.5 rounded transition-colors ${
                  isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
                } hover:bg-slate-100/80`}
              >
                <div className="flex items-start gap-1.5">
                  {goal.progress === 100 ? (
                    <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5 text-emerald-400/70" />
                  ) : (
                    <Target size={12} className={`flex-shrink-0 mt-0.5 ${typeColor}`} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-600 leading-snug">{goal.statement}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1 bg-slate-200/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-400/70 rounded-full transition-all"
                          style={{ width: `${goal.progress}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400 font-medium w-7 text-right">
                        {goal.progress}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {goal.type && (
                        <span className="text-[9px] text-slate-400">{goal.type}</span>
                      )}
                      <span className="text-[9px] text-slate-300">· {formatRelativeTime(goal.lastReferenced)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Goal Manager Modal */}
      {showManager && <GoalManager onClose={() => setShowManager(false)} />}
    </>
  );
};
