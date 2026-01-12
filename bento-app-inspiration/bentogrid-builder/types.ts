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

export interface LeafNode extends BaseNode {
  type: 'leaf';
  content: string; // Placeholder for content type or data
  color: string; // Visual differentiation
}

export type BentoNode = SplitNode | LeafNode;

export type NodeMap = Record<string, BentoNode>;

export interface BentoTree {
  rootId: string;
  nodes: NodeMap;
}
