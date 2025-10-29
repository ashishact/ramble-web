import type { NodeCardProps } from './types';

export function NodeCard({ node }: NodeCardProps) {
  if (!node) {
    return (
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-4">
          <div className="text-base-content/60 text-center">
            <p className="text-sm font-medium mb-1">No active node</p>
            <p className="text-xs">Start speaking to create your first knowledge node</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow-md transition-shadow">
      <div className="card-body p-4">
        <div className="flex items-start gap-2 mb-3">
          {node.icon && (
            <div className="text-2xl">{node.icon}</div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="card-title text-base font-semibold text-base-content mb-1 break-words">
              {node.title}
            </h2>
            <div className="text-xs text-base-content/50">
              {new Date(node.createdAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="mb-3">
          <p className="text-sm text-base-content/80 whitespace-pre-wrap leading-relaxed break-words">
            {node.content}
          </p>
        </div>

        {node.tags && node.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {node.tags.map((tag, index) => (
              <span
                key={index}
                className="badge badge-sm badge-outline badge-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
