import { useState } from 'react';
import type { WidgetProps } from '../types';
import { WorkingMemory } from '../../components/v2/WorkingMemory';

export const WorkingMemoryWidget: React.FC<WidgetProps> = () => {
  const [refreshTrigger] = useState(0);

  return (
    <div
      className="w-full h-full overflow-auto"
      data-doc='{"icon":"mdi:memory","title":"Working Memory","desc":"Shows the context sent to the AI: recent conversation, known entities, active topics, memories, and goals. Use S/M/L to adjust context size."}'
    >
      <WorkingMemory refreshTrigger={refreshTrigger} />
    </div>
  );
};
