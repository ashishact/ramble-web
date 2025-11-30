/**
 * Semantic search state manager
 * Preserves search query and results when toggling views
 */

import type { KnowledgeNode } from '../../../backend/types';

interface SemanticSearchState {
  searchQuery: string;
  results: KnowledgeNode[];
  hasSearched: boolean;
}

// In-memory state (survives component unmount/remount)
let state: SemanticSearchState = {
  searchQuery: '',
  results: [],
  hasSearched: false,
};

export const semanticSearchState = {
  get: () => state,

  setQuery: (query: string) => {
    state.searchQuery = query;
  },

  setResults: (results: KnowledgeNode[], hasSearched: boolean) => {
    state.results = results;
    state.hasSearched = hasSearched;
  },

  clear: () => {
    state = {
      searchQuery: '',
      results: [],
      hasSearched: false,
    };
  },
};
