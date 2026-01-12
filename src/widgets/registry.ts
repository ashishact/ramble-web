import type { WidgetType } from '../components/bento/types';
import type { WidgetDefinition } from './types';

class WidgetRegistry {
  private widgets: Map<WidgetType, WidgetDefinition> = new Map();

  register(definition: WidgetDefinition): void {
    this.widgets.set(definition.type, definition);
  }

  get(type: WidgetType): WidgetDefinition | undefined {
    return this.widgets.get(type);
  }

  getAll(): WidgetDefinition[] {
    return Array.from(this.widgets.values());
  }

  has(type: WidgetType): boolean {
    return this.widgets.has(type);
  }
}

export const widgetRegistry = new WidgetRegistry();
