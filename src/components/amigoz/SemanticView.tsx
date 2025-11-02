import { useState, useEffect } from 'react';
import { semanticSearch } from '../../utils/knowledgeApi';
import { SemanticGraphView } from './semantic/SemanticGraphView';
import { semanticSearchState } from './semantic/semanticSearchState';

interface KnowledgeNode {
  id: number;
  title: string;
  content: string;
  tags: string[];
  icon?: string;
  similarity?: number;
  createdAt: string;
}

interface SemanticViewProps {
  onNodeSelect: (nodeId: number) => void;
}

export function SemanticView({ onNodeSelect }: SemanticViewProps) {
  // Load saved state on mount
  const savedState = semanticSearchState.get();

  const [searchQuery, setSearchQuery] = useState(savedState.searchQuery);
  const [results, setResults] = useState<KnowledgeNode[]>(savedState.results);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(savedState.hasSearched);

  // Persist state changes
  useEffect(() => {
    semanticSearchState.setQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    semanticSearchState.setResults(results, hasSearched);
  }, [results, hasSearched]);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    const timeoutId = setTimeout(async () => {
      try {
        const data = await semanticSearch(searchQuery, 20);
        setResults(data);
      } catch (error) {
        console.error('Semantic search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  return (
    <div className="flex flex-col h-full bg-base-200">
      {/* Search Bar at Bottom */}
      <div className="flex-1 overflow-y-auto p-4">
        {!hasSearched && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-base-content/60">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-16 h-16 mx-auto mb-4 opacity-40"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              <p className="text-lg font-medium">Semantic Search</p>
              <p className="text-sm mt-2">
                Search your knowledge base using natural language
              </p>
              <p className="text-xs mt-1 opacity-50">
                Try: "machine learning concepts", "how to debug", etc.
              </p>
            </div>
          </div>
        )}

        {hasSearched && !isLoading && results.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-base-content/60">
              <p className="text-lg">No results found</p>
              <p className="text-sm mt-2">Try a different search query</p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        )}

        {hasSearched && !isLoading && results.length > 0 && (
          <SemanticGraphView
            queryText={searchQuery}
            results={results}
            onNodeSelect={onNodeSelect}
          />
        )}
      </div>

      {/* Search Bar */}
      <div className="p-4 bg-base-100 border-t border-base-300">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search with natural language..."
              className="input input-bordered w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isLoading && (
              <span className="loading loading-spinner loading-sm absolute right-3 top-1/2 -translate-y-1/2"></span>
            )}
          </div>
        </div>
        {hasSearched && results.length > 0 && (
          <p className="text-xs text-base-content/50 mt-2">
            Found {results.length} results for "{searchQuery}"
          </p>
        )}
      </div>
    </div>
  );
}
