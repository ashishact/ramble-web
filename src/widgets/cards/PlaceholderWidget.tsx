import type { WidgetProps } from '../types';
import type { WidgetType } from '../../components/bento/types';
import { Mic, MessageSquare, Users, Target, Settings, Volume2, Sparkles, Radio, GitBranch, FlaskConical, Compass, Layers, PenTool } from 'lucide-react';

const WIDGET_ICONS: Record<WidgetType, React.ReactNode> = {
  'empty': null,
  'voice-recorder': <Mic className="w-8 h-8" />,
  'text-input': <PenTool className="w-8 h-8" />,
  'conversation': <MessageSquare className="w-8 h-8" />,
  'entities': <Users className="w-8 h-8" />,
  'goals': <Target className="w-8 h-8" />,
  'speak-better': <Sparkles className="w-8 h-8" />,
  'settings': <Settings className="w-8 h-8" />,
  'tts': <Volume2 className="w-8 h-8" />,
  'meeting-transcription': <Radio className="w-8 h-8" />,
  'knowledge-tree': <GitBranch className="w-8 h-8" />,
  'embedding-test': <FlaskConical className="w-8 h-8" />,
  'knowledge-map': <Compass className="w-8 h-8" />,
  'canonical-view': <Layers className="w-8 h-8" />,
  'domain-tree': <GitBranch className="w-8 h-8" />,
};

const WIDGET_LABELS: Record<WidgetType, string> = {
  'empty': 'Empty',
  'voice-recorder': 'Voice Recorder',
  'text-input': 'Text Input',
  'conversation': 'Conversation',
  'entities': 'Entities',
  'goals': 'Goals',
  'speak-better': 'Speak Better',
  'settings': 'Settings',
  'tts': 'Text to Speech',
  'meeting-transcription': 'Meeting',
  'knowledge-tree': 'Knowledge Tree',
  'embedding-test': 'Embedding Test',
  'knowledge-map': 'Knowledge Map',
  'canonical-view': 'Canonical View',
  'domain-tree': 'Domain Tree',
};

interface PlaceholderWidgetProps extends WidgetProps {
  widgetType: WidgetType;
}

export const PlaceholderWidget: React.FC<PlaceholderWidgetProps> = ({ widgetType }) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
      <div className="mb-2 opacity-50">
        {WIDGET_ICONS[widgetType]}
      </div>
      <span className="text-sm font-medium">{WIDGET_LABELS[widgetType]}</span>
      <span className="text-xs opacity-50 mt-1">Widget coming soon</span>
    </div>
  );
};
