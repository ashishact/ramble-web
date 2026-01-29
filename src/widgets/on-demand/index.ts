/**
 * On-Demand Widgets
 *
 * These widgets only run their processes when loaded into the UI.
 * They are self-contained - each widget bundles its own process logic.
 * Results are typically volatile (not saved to database).
 */

export { QuestionWidget } from './questions';
export { SuggestionWidget } from './suggestions';
