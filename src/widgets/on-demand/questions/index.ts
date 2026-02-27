/**
 * Questions Widget
 *
 * On-demand widget that analyzes working memory and identifies gaps.
 * Prompts users to provide more information through targeted questions.
 * Triggered after core pipeline completes (not on load).
 * In meeting mode (native:mode-changed → 'meeting'), switches to asking
 * questions the user could pose to other participants based on live transcript.
 */

export { QuestionWidget } from './Widget';
export {
  generateQuestions,
  generateMeetingQuestions,
  saveQuestionsToStorage,
  loadQuestionsFromStorage,
  type Question,
  type QuestionResult,
} from './process';
