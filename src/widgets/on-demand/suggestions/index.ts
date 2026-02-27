/**
 * Suggestions Widget
 *
 * On-demand widget that analyzes working memory and provides actionable suggestions.
 * Suggests solutions, actions, and next steps based on conversation context.
 * Triggered after core pipeline completes (not on load).
 * In meeting mode (native:mode-changed → 'meeting'), switches to suggesting
 * things the user could say or do in response to other participants.
 */

export { SuggestionWidget } from './Widget';
export {
  generateSuggestions,
  generateMeetingSuggestions,
  saveSuggestionsToStorage,
  loadSuggestionsFromStorage,
  type Suggestion,
  type SuggestionResult,
} from './process';
