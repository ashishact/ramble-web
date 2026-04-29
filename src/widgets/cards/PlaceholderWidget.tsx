import type { WidgetProps } from '../types';
import type { WidgetType } from '../../components/bento/types';
import { Mic, MessageSquare, Users, Hash, Brain, Target, BarChart3, Settings, Eye, PenTool, HelpCircle, Lightbulb, Pencil, Volume2, Search, Sparkles, Radio, GitBranch, Clock, FlaskConical, Activity, Compass, Layers } from 'lucide-react';

const WIDGET_ICONS: Record<WidgetType, React.ReactNode> = {
  'empty': null,
  'voice-recorder': <Mic className="w-8 h-8" />,
  'text-input': <PenTool className="w-8 h-8" />,
  'conversation': <MessageSquare className="w-8 h-8" />,
  'entities': <Users className="w-8 h-8" />,
  'topics': <Hash className="w-8 h-8" />,
  'memories': <Brain className="w-8 h-8" />,
  'goals': <Target className="w-8 h-8" />,
  'stats': <BarChart3 className="w-8 h-8" />,
  'questions': <HelpCircle className="w-8 h-8" />,
  'suggestions': <Lightbulb className="w-8 h-8" />,
  'speak-better': <Sparkles className="w-8 h-8" />,
  'settings': <Settings className="w-8 h-8" />,
  'working-memory': <Eye className="w-8 h-8" />,
  'learned-corrections': <Pencil className="w-8 h-8" />,
  'tts': <Volume2 className="w-8 h-8" />,
  'meeting-transcription': <Radio className="w-8 h-8" />,
  // Lens Widgets
  'meta-query': <Search className="w-8 h-8" />,
  // Knowledge tree widgets (v9)
  'knowledge-tree': <GitBranch className="w-8 h-8" />,
  'timeline': <Clock className="w-8 h-8" />,
  // Observability widgets (v10)
  'pipeline-monitor': <Activity className="w-8 h-8" />,
  'google-search': <Search className="w-8 h-8" />,
  'embedding-test': <FlaskConical className="w-8 h-8" />,
  'synthesis': <Brain className="w-8 h-8" />,
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
  'topics': 'Topics',
  'memories': 'Memories',
  'goals': 'Goals',
  'stats': 'Stats',
  'questions': 'Questions',
  'suggestions': 'Suggestions',
  'speak-better': 'Speak Better',
  'settings': 'Settings',
  'working-memory': 'Working Memory',
  'learned-corrections': 'Learned Corrections',
  'tts': 'Text to Speech',
  'meeting-transcription': 'Meeting',
  // Lens Widgets
  'meta-query': 'Meta Query',
  // Knowledge tree widgets (v9)
  'knowledge-tree': 'Knowledge Tree',
  'timeline': 'Timeline',
  // Observability widgets (v10)
  'pipeline-monitor': 'Pipeline Monitor',
  'google-search': 'Google Search',
  'embedding-test': 'Embedding Test',
  'synthesis': 'Synthesis',
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
