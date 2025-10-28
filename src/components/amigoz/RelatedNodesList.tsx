import { useState, useEffect } from 'react';
import type { RelatedNodesListProps, RelatedKnowledgeNode } from './types';

export function RelatedNodesList({ nodeId, onNodeClick }: RelatedNodesListProps) {
  const [relatedNodes, setRelatedNodes] = useState<RelatedKnowledgeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRelatedNodes = async () => {
      if (!nodeId) {
        setRelatedNodes([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/knowledge/nodes/${nodeId}/related`);
        if (!response.ok) {
          throw new Error('Failed to fetch related nodes');
        }
        const data = await response.json();
        setRelatedNodes(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setRelatedNodes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRelatedNodes();
  }, [nodeId]);

  if (loading) {
    return (
      <div className="text-gray-400 text-sm text-center py-4">
        Loading related nodes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm text-center py-4">
        {error}
      </div>
    );
  }

  if (relatedNodes.length === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-4">
        No related nodes found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {relatedNodes.map((node) => (
        <div
          key={node.id}
          onClick={() => onNodeClick(node.id)}
          className="bg-gray-800 rounded-lg p-4 border border-gray-700 cursor-pointer hover:border-blue-500 hover:bg-gray-750 transition-colors"
        >
          <div className="flex items-start gap-2 mb-2">
            {node.icon && (
              <div className="text-xl">{node.icon}</div>
            )}
            <div className="flex-1">
              <h3 className="text-white font-medium text-sm">{node.title}</h3>
              <div className="text-xs text-gray-500 mt-1">
                {node.relationshipType === 'outgoing' ? '→' : '←'} {node.relationshipDescription}
              </div>
            </div>
          </div>
          <p className="text-gray-400 text-xs line-clamp-2">
            {node.content}
          </p>
          {node.tags && node.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {node.tags.map((tag, index) => (
                <span
                  key={index}
                  className="px-1.5 py-0.5 bg-blue-900/20 text-blue-400 text-xs rounded border border-blue-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
