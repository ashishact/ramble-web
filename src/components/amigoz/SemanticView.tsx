import { useState, useEffect } from 'react';
import { semanticSearch } from '../../backend/api';
import { SemanticGraphView } from './semantic/SemanticGraphView';
import { semanticSearchState } from './semantic/semanticSearchState';
import type { KnowledgeNode } from '../../backend/types';

interface SemanticViewProps {
  onNodeSelect: (nodeId: number) => void;
  customEvents: { event: string; data: any } | null;
}

export function SemanticView({ onNodeSelect, customEvents }: SemanticViewProps) {
  // Load saved state on mount
  const savedState = semanticSearchState.get();

  const [searchQuery, setSearchQuery] = useState(savedState.searchQuery);
  const [results, setResults] = useState<KnowledgeNode[]>(savedState.results);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(savedState.hasSearched);
  const [selectedNodeId, setSelectedNodeId] = useState<number | undefined>();

  // Persist state changes
  useEffect(() => {
    semanticSearchState.setQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    semanticSearchState.setResults(results, hasSearched);
  }, [results, hasSearched]);

  // Listen for node updates and refresh the affected node in results
  useEffect(() => {
    if (!customEvents) return;

    if (customEvents.event === 'node-updated') {
      const updatedNode = customEvents.data;

      // Update the node in results if it exists
      setResults((prevResults) => {
        const nodeIndex = prevResults.findIndex((n) => n.id === updatedNode.id);
        if (nodeIndex === -1) return prevResults;

        const newResults = [...prevResults];
        newResults[nodeIndex] = {
          ...newResults[nodeIndex],
          title: updatedNode.title,
          content: updatedNode.content,
          tags: updatedNode.tags,
          icon: updatedNode.icon,
        };
        return newResults;
      });
    }
  }, [customEvents]);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      // Don't clear results when query is empty, just don't search
      // Keep the last search results visible
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
        // Don't clear results on error, keep showing last successful results
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

        {hasSearched && results.length > 0 && (
          <SemanticGraphView
            queryText={searchQuery}
            results={results}
            onNodeSelect={(nodeId) => {
              setSelectedNodeId(nodeId);
              onNodeSelect(nodeId);
            }}
            selectedNodeId={selectedNodeId}
          />
        )}
      </div>

      {/* Search Bar */}
      <div className="p-4 bg-base-100 border-t border-base-300">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Search with natural language..."
            className="input input-bordered flex-1"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isLoading && (
            <span className="loading loading-spinner loading-sm"></span>
          )}
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
