/**
 * Questions Widget
 *
 * On-demand widget that analyzes working memory and identifies gaps.
 * Prompts users to provide more information through targeted questions.
 * Triggered by processing:system-i (throttled) and processing:system-ii (immediate) events.
 */

export { QuestionWidget } from './Widget';
export {
  generateQuestions,
  saveQuestionsToStorage,
  loadQuestionsFromStorage,
  type Question,
  type QuestionResult,
} from './process';
