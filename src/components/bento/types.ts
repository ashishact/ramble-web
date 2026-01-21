export type Direction = 'horizontal' | 'vertical';

export type NodeType = 'leaf' | 'split';

export interface BaseNode {
  id: string;
  type: NodeType;
  parent: string | null;
}

export interface SplitNode extends BaseNode {
  type: 'split';
  direction: Direction;
  ratio: number; // 0.0 to 1.0 represents the position of the divider
  first: string; // ID of the first child (left/top)
  second: string; // ID of the second child (right/bottom)
}

// Widget types that can be rendered in a bento card
export type WidgetType =
  | 'empty'           // Widget picker placeholder
  | 'voice-recorder'  // Voice recording input
  | 'text-input'      // Text input field
  | 'conversation'    // Conversation history
  | 'entities'        // Entity list/browser
  | 'topics'          // Active topics
  | 'memories'        // Active memories
  | 'goals'           // Goals with progress
  | 'stats'           // Quick stats
  | 'settings'        // Settings panel
  | 'working-memory'  // Full context view
  | 'suggestions';    // AI-powered suggestions (volatile, not saved)

export interface LeafNode extends BaseNode {
  type: 'leaf';
  content: string;           // Display name/label
  color: string;             // Visual differentiation (Tailwind class)
  widgetType: WidgetType;    // Which widget to render
  widgetConfig?: Record<string, unknown>;  // Optional widget-specific configuration
}

export type BentoNode = SplitNode | LeafNode;

export type NodeMap = Record<string, BentoNode>;

export interface BentoTree {
  rootId: string;
  nodes: NodeMap;
}
