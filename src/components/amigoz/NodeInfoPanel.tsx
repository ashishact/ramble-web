/**
 * Node Info Panel - Middle panel showing current node, search, and related nodes
 */
import { NodeCard } from './NodeCard';
import { SearchBar } from './SearchBar';
import { RelatedNodesList } from './RelatedNodesList';
import type { KnowledgeNode } from './types';

interface NodeInfoPanelProps {
  currentNode: KnowledgeNode | null;
  relationshipVersion: number;
  onNodeSelect: (nodeId: number) => void;
}

export function NodeInfoPanel({
  currentNode,
  relationshipVersion,
  onNodeSelect,
}: NodeInfoPanelProps) {
  return (
    <div className="h-full overflow-auto bg-base-200 border-l border-base-300">
      <div className="p-4">
        {/* Search Bar */}
        <div className="mb-4">
          <SearchBar onNodeSelect={onNodeSelect} />
        </div>

        {/* Current Node */}
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-base-content/80 mb-2">
            Current Node
          </h2>
          <NodeCard node={currentNode} onNodeClick={onNodeSelect} />
        </div>

        {/* Related Nodes */}
        {currentNode && (
          <div>
            <h2 className="text-sm font-semibold text-base-content/80 mb-2">
              Related Nodes
            </h2>
            <RelatedNodesList
              key={`${currentNode.id}-${relationshipVersion}`}
              nodeId={currentNode.id}
              onNodeClick={onNodeSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
}
