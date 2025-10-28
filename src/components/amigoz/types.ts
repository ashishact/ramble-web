export interface KnowledgeNode {
  id: number;
  title: string;
  content: string;
  tags: string[];
  icon?: string;
  createdBy: string;
  createdAt: string;
}

export interface RelatedKnowledgeNode extends KnowledgeNode {
  relationshipDescription: string;
  relationshipType: 'outgoing' | 'incoming';
}

export interface KnowledgeRelationship {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  description: string;
  createdBy: string;
  createdAt: string;
}

export interface NodeCardProps {
  node: KnowledgeNode | null;
  onNodeClick?: (nodeId: number) => void;
}

export interface RelatedNodesListProps {
  nodeId: number;
  onNodeClick: (nodeId: number) => void;
}

export interface SearchBarProps {
  onNodeSelect: (nodeId: number) => void;
}
