import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { goalStore } from '../../db/stores';
import type Goal from '../../db/models/Goal';
import { formatRelativeTime } from '../../program/utils';
import { Target, CheckCircle2 } from 'lucide-react';

export const GoalsWidget: React.FC<WidgetProps> = () => {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const loadGoals = async () => {
      const active = await goalStore.getActive();
      setGoals(active);
    };
    loadGoals();

    // Poll for updates
    const interval = setInterval(loadGoals, 5000);
    return () => clearInterval(interval);
  }, []);

  if (goals.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
        <Target className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No active goals</span>
        <span className="text-xs opacity-50 mt-1">Goals will appear here</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="space-y-2">
        {goals.map((goal) => (
          <div
            key={goal.id}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
          >
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 mt-0.5">
                {goal.progress === 100 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Target className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 font-medium">{goal.statement}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    {goal.progress}%
                  </span>
                </div>
                {goal.type && (
                  <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded-full">
                    {goal.type}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 block mt-1">
                  {formatRelativeTime(goal.lastReferenced)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
