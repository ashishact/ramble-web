/**
 * Extraction Programs Index
 *
 * Import this file to register all extraction programs.
 * Each extractor self-registers when imported.
 */

// Core extractors - always run (priority 90+)
export { factualExtractor } from './factualExtractor';
export { emotionExtractor } from './emotionExtractor';

// High-priority extractors (priority 70-89)
export { valueExtractor } from './valueExtractor';
export { goalExtractor } from './goalExtractor';
export { commitmentExtractor } from './commitmentExtractor';
export { selfPerceptionExtractor } from './selfPerceptionExtractor';
export { intentionExtractor } from './intentionExtractor';
export { concernExtractor } from './concernExtractor';
export { decisionExtractor } from './decisionExtractor';

// Medium-priority extractors (priority 50-69)
export { learningExtractor } from './learningExtractor';
export { beliefExtractor } from './beliefExtractor';
export { memoryReferenceExtractor } from './memoryReferenceExtractor';
export { changeMarkerExtractor } from './changeMarkerExtractor';
export { preferenceExtractor } from './preferenceExtractor';
export { relationshipExtractor } from './relationshipExtractor';
export { habitExtractor } from './habitExtractor';

// Lower-priority extractors (priority < 50)
export { hypotheticalExtractor } from './hypotheticalExtractor';
export { causalExtractor } from './causalExtractor';
export { questionExtractor } from './questionExtractor';
export { entityExtractor } from './entityExtractor';
