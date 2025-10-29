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
      <div className="text-base-content/60 text-xs text-center py-3">
        <span className="loading loading-spinner loading-sm"></span>
        <p className="mt-1">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error py-2 text-xs">
        {error}
      </div>
    );
  }

  if (relatedNodes.length === 0) {
    return (
      <div className="text-base-content/50 text-xs text-center py-3">
        No related nodes found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {relatedNodes.map((node) => (
        <div
          key={node.id}
          onClick={() => onNodeClick(node.id)}
          className="card card-compact bg-base-100 border border-base-300 cursor-pointer hover:border-primary hover:shadow-sm transition-all"
        >
          <div className="card-body p-3">
            <div className="flex items-start gap-2 mb-1">
              {node.icon && (
                <div className="text-lg">{node.icon}</div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-base-content font-medium text-sm break-words">{node.title}</h3>
                <div className="text-xs text-base-content/50 mt-0.5">
                  {node.relationshipType === 'outgoing' ? '→' : '←'} {node.relationshipDescription}
                </div>
              </div>
            </div>
            <p className="text-base-content/70 text-xs line-clamp-2 break-words">
              {node.content}
            </p>
            {node.tags && node.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {node.tags.slice(0, 3).map((tag, index) => (
                  <span
                    key={index}
                    className="badge badge-xs badge-outline badge-secondary"
                  >
                    {tag}
                  </span>
                ))}
                {node.tags.length > 3 && (
                  <span className="badge badge-xs badge-ghost">
                    +{node.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
