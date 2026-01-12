import { useState } from 'react';
import type { WidgetProps } from '../types';
import { WorkingMemory } from '../../components/v2/WorkingMemory';

export const WorkingMemoryWidget: React.FC<WidgetProps> = () => {
  const [refreshTrigger] = useState(0);

  return (
    <div className="w-full h-full overflow-auto">
      <WorkingMemory refreshTrigger={refreshTrigger} />
    </div>
  );
};
