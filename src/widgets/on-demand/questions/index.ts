/**
 * Questions Widget
 *
 * On-demand widget that analyzes working memory and identifies gaps.
 * Prompts users to provide more information through targeted questions.
 * Triggered after core pipeline completes (not on load).
 * Results stored in localStorage for persistence across reloads.
 */

export { QuestionWidget } from './Widget';
export {
  generateQuestions,
  saveQuestionsToStorage,
  loadQuestionsFromStorage,
  clearQuestionsFromStorage,
  type Question,
  type QuestionResult,
} from './process';
