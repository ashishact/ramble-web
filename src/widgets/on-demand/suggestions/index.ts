/**
 * Suggestions Widget
 *
 * On-demand widget that analyzes working memory and provides actionable suggestions.
 * Suggests solutions, actions, and next steps based on conversation context.
 * Triggered after core pipeline completes (not on load).
 * Results stored in localStorage for persistence across reloads.
 */

export { SuggestionWidget } from './Widget';
export {
  generateSuggestions,
  saveSuggestionsToStorage,
  loadSuggestionsFromStorage,
  clearSuggestionsFromStorage,
  type Suggestion,
  type SuggestionResult,
} from './process';
