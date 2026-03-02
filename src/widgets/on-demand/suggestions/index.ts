/**
 * Suggestions Widget
 *
 * On-demand widget that analyzes working memory and provides actionable suggestions.
 * Suggests solutions, actions, and next steps based on conversation context.
 * Triggered by processing:system-i (throttled) and processing:system-ii (immediate) events.
 */

export { SuggestionWidget } from './Widget';
export {
  generateSuggestions,
  saveSuggestionsToStorage,
  loadSuggestionsFromStorage,
  type Suggestion,
  type SuggestionResult,
} from './process';
