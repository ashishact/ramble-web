import type { NodeCardProps } from './types';

export function NodeCard({ node }: NodeCardProps) {
  if (!node) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="text-gray-400 text-center">
          <p className="text-lg mb-2">No active node</p>
          <p className="text-sm">Start speaking to create your first knowledge node</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 shadow-lg">
      <div className="flex items-start gap-3 mb-4">
        {node.icon && (
          <div className="text-3xl">{node.icon}</div>
        )}
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-white mb-1">{node.title}</h2>
          <div className="text-xs text-gray-400">
            {new Date(node.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">
          {node.content}
        </p>
      </div>

      {node.tags && node.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {node.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2 py-1 bg-blue-900/30 text-blue-300 text-xs rounded-full border border-blue-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
