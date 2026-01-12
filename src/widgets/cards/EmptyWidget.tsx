import type { WidgetProps } from '../types';

export const EmptyWidget: React.FC<WidgetProps> = () => {
  return (
    <div className="w-full h-full flex items-center justify-center text-slate-400">
      Select a widget
    </div>
  );
};
