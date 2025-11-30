import { useState, useCallback } from 'react';
import { searchNodes } from '../../backend/api';
import type { KnowledgeNode } from '../../backend/types';

interface SearchBarProps {
  onNodeSelect: (nodeId: number) => void;
}

export function SearchBar({ onNodeSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);

    try {
      const data = await searchNodes(searchQuery, 10);
      setResults(data);
      setShowResults(true);
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Debounce search
    const timeoutId = setTimeout(() => {
      handleSearch(value);
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  const handleSelectNode = (nodeId: number) => {
    onNodeSelect(nodeId);
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => query && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          placeholder="Search nodes..."
          className="input input-sm input-bordered w-full focus:input-primary"
        />
        {isSearching && (
          <div className="absolute right-3 top-1.5">
            <span className="loading loading-spinner loading-xs"></span>
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {results.map((node) => (
            <div
              key={node.id}
              onClick={() => handleSelectNode(node.id)}
              className="p-2 cursor-pointer hover:bg-base-200 border-b border-base-300 last:border-b-0 transition-colors"
            >
              <div className="flex items-start gap-2">
                {node.icon && (
                  <div className="text-base">{node.icon}</div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-base-content font-medium text-xs truncate">
                    {node.title}
                  </h4>
                  <p className="text-base-content/60 text-xs mt-0.5 line-clamp-2">
                    {node.content}
                  </p>
                  {node.tags && node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {node.tags.slice(0, 2).map((tag, index) => (
                        <span
                          key={index}
                          className="badge badge-xs badge-outline badge-accent"
                        >
                          {tag}
                        </span>
                      ))}
                      {node.tags.length > 2 && (
                        <span className="badge badge-xs badge-ghost">
                          +{node.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showResults && query && !isSearching && results.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 text-center text-base-content/60 text-xs">
          No nodes found matching "{query}"
        </div>
      )}
    </div>
  );
}
