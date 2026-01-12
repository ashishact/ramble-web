import type { WidgetType } from '../components/bento/types';

export interface WidgetProps {
  nodeId: string;
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}

export interface WidgetDefinition {
  type: WidgetType;
  name: string;
  icon: string; // Lucide icon name
  description: string;
  component: React.ComponentType<WidgetProps>;
  defaultConfig?: Record<string, unknown>;
  minWidth?: number;
  minHeight?: number;
}
