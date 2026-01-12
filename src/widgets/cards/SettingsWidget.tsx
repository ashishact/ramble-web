import { useNavigate } from 'react-router-dom';
import type { WidgetProps } from '../types';
import { Settings, ExternalLink } from 'lucide-react';

export const SettingsWidget: React.FC<WidgetProps> = () => {
  const navigate = useNavigate();

  return (
    <div className="w-full h-full p-4 flex flex-col items-center justify-center">
      <Settings className="w-12 h-12 text-slate-300 mb-4" />
      <p className="text-sm text-slate-600 text-center mb-4">
        Configure API keys and preferences
      </p>
      <button
        onClick={() => navigate('/settings')}
        className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
      >
        Open Settings
        <ExternalLink size={14} />
      </button>
    </div>
  );
};
