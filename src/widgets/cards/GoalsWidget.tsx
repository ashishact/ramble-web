import { useState, useEffect, useMemo } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Goal from '../../db/models/Goal';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Target, CheckCircle2, Settings, ChevronRight } from 'lucide-react';
import { GoalManager } from '../../components/v2/GoalManager';

// Muted colors for goal types
const typeColors: Record<string, string> = {
  'short-term': 'text-blue-400/70',
  'long-term': 'text-purple-400/70',
  'recurring': 'text-amber-400/70',
  'milestone': 'text-emerald-400/70',
};

// Parse namespace from goal statement: "Category / Goal / Sub-goal"
function parseGoalNamespace(statement: string): { category: string; path: string[] } {
  const parts = statement.split(' / ').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { category: 'Uncategorized', path: [statement] };
  }
  if (parts.length === 1) {
    return { category: 'Uncategorized', path: parts };
  }
  return { category: parts[0], path: parts.slice(1) };
}

// Group goals by category
function groupGoalsByCategory(goals: Goal[]): Map<string, Goal[]> {
  const groups = new Map<string, Goal[]>();
  for (const goal of goals) {
    const { category } = parseGoalNamespace(goal.statement);
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(goal);
  }
  return groups;
}

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

  const groupedGoals = useMemo(() => groupGoalsByCategory(goals), [goals]);

  if (goals.length === 0) {
    return (
      <>
        <div
          className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2"
          data-doc='{"icon":"mdi:target","title":"Goals","desc":"Track your short-term, long-term, recurring, and milestone goals. Progress is shown as a percentage. Only active goals are displayed."}'
        >
          <Target className="w-5 h-5 mb-1 opacity-40" />
          <span className="text-[10px]">No active goals</span>
        </div>
        {showManager && <GoalManager onClose={() => setShowManager(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        data-doc='{"icon":"mdi:target","title":"Goals","desc":"Your active goals with progress bars. Goals can be short-term, long-term, recurring, or milestones. Click gear to manage."}'
      >
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

        {/* Goal list grouped by category */}
        <div className="flex-1 overflow-auto p-1.5">
          {Array.from(groupedGoals.entries()).map(([category, categoryGoals]) => (
            <div key={category} className="mb-2 last:mb-0">
              {/* Category header */}
              <div className="flex items-center gap-1 px-1 py-0.5 mb-1">
                <ChevronRight size={10} className="text-slate-400" />
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                  {category}
                </span>
                <span className="text-[9px] text-slate-300">({categoryGoals.length})</span>
              </div>
              {/* Goals in category */}
              {categoryGoals.map((goal, index) => {
                const { path } = parseGoalNamespace(goal.statement);
                const displayName = path.join(' / ');
                const isOdd = index % 2 === 1;
                const typeColor = typeColors[goal.type] || 'text-slate-400/70';
                return (
                  <div
                    key={goal.id}
                    className={`px-2 py-1.5 ml-2 rounded transition-colors ${
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
                        <p className="text-xs text-slate-600 leading-snug">{displayName}</p>
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
          ))}
        </div>
      </div>

      {/* Goal Manager Modal */}
      {showManager && <GoalManager onClose={() => setShowManager(false)} />}
    </>
  );
};
