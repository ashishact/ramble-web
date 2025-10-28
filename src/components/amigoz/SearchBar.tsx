import { useState, useCallback } from 'react';
import type { SearchBarProps, KnowledgeNode } from './types';

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
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(
        `${apiUrl}/knowledge/nodes/search?q=${encodeURIComponent(searchQuery)}&limit=10`
      );
      if (!response.ok) {
        throw new Error('Failed to search nodes');
      }
      const data = await response.json();
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
          placeholder="Search knowledge nodes..."
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {isSearching && (
          <div className="absolute right-3 top-2.5">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {results.map((node) => (
            <div
              key={node.id}
              onClick={() => handleSelectNode(node.id)}
              className="p-3 cursor-pointer hover:bg-gray-700 border-b border-gray-700 last:border-b-0 transition-colors"
            >
              <div className="flex items-start gap-2">
                {node.icon && (
                  <div className="text-lg">{node.icon}</div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-medium text-sm truncate">
                    {node.title}
                  </h4>
                  <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                    {node.content}
                  </p>
                  {node.tags && node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {node.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="px-1.5 py-0.5 bg-blue-900/20 text-blue-400 text-xs rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showResults && query && !isSearching && results.length === 0 && (
        <div className="absolute z-10 w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
          No nodes found matching "{query}"
        </div>
      )}
    </div>
  );
}
