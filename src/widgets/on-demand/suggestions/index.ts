/**
 * Suggestions Widget
 *
 * On-demand widget that analyzes working memory and suggests what to talk about.
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
