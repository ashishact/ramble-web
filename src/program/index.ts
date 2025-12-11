/**
 * Program Module - Main Entry Point
 *
 * RAMBLE: Reasoning Architecture for Memory-Based Learning and Extraction
 *
 * This module provides a comprehensive system for:
 * - Extracting claims from conversation
 * - Organizing claims into thought chains
 * - Tracking goals and progress
 * - Detecting patterns and contradictions
 *
 * Usage:
 *   import { getKernel } from '@/program';
 *
 *   const kernel = getKernel();
 *   await kernel.initialize();
 *   kernel.startSession();
 *   await kernel.processText("I've been thinking about career changes...", 'user');
 */

// Kernel - main API
export {
  ProgramKernel,
  getKernel,
  resetKernel,
  type KernelConfig,
  type KernelState,
  type KernelStats,
} from './kernel';

// Types
export type {
  // Session
  Session,
  CreateSession,
  UpdateSession,

  // Conversation
  ConversationSource,
  ConversationUnit,
  CreateConversationUnit,
  UpdateConversationUnit,

  // Claims
  ClaimType,
  Temporality,
  Abstraction,
  SourceType,
  ClaimState,
  Stakes,
  Claim,
  CreateClaim,
  UpdateClaim,
  ClaimSource,
  CreateClaimSource,

  // Entities
  EntityType,
  Entity,
  CreateEntity,
  UpdateEntity,

  // Goals
  GoalType,
  GoalTimeframe,
  GoalStatus,
  ProgressType,
  BlockerType,
  BlockerSeverity,
  BlockerStatus,
  MilestoneStatus,
  Goal,
  CreateGoal,
  UpdateGoal,
  Milestone,
  Blocker,

  // Tasks
  TaskType,
  TaskStatus,
  TaskPriority,
  BackoffConfig,
  TaskCheckpoint,
  Task,
  CreateTask,
  UpdateTask,

  // Observers
  ObserverType,
  TriggerType,
  ObserverTrigger,
  ObserverOutput,
  CreateObserverOutput,
  UpdateObserverOutput,
  Contradiction,
  CreateContradiction,
  Pattern,
  CreatePattern,
  Value,
  CreateValue,

  // Corrections
  Correction,
  CreateCorrection,
  UpdateCorrection,

  // Memory System
  MemoryTier,
  SalienceFactors,
  TopOfMind,
  SalientTopic,
  SalientEntity,
  SalientGoal,
  SalientConcern,
  SalientQuestion,
  EmotionalHighlight,
  MemoryStats,
  DecayConfig,
  DecayResult,
  SalienceWeights,
  MemoryServiceConfig,
} from './types';

// Goal Manager
export {
  GoalManager,
  createGoalManager,
  type GoalManagerConfig,
  type GoalWithContext,
  type GoalTreeNode,
  type GoalProgressUpdate,
} from './goals';

// Observers
export {
  BaseObserver,
  ObserverDispatcher,
  createDispatcher,
  createStandardDispatcher,
  ContradictionObserver,
  PatternObserver,
  type Observer,
  type ObserverConfig,
  type ObserverContext,
  type ObserverResult,
  type ObserverEvent,
  type DispatcherStats,
  type DispatcherConfig,
} from './observers';

// Pipeline
export {
  callLLM,
  runExtractionPipeline,
  buildBudgetedContext,
  QueueRunner,
  createQueueRunner,
  type LLMRequest,
  type LLMResponse,
  type PipelineInput,
  type PipelineOutput,
  type TaskHandler,
  type QueueRunnerConfig,
} from './pipeline';

// Extractors
export {
  extractorRegistry,
  registerExtractor,
  BaseExtractor,
  parseJSONResponse,
  findPatternMatches,
  getRelevantSegments,
  shouldExtractorRun,
  mergeAdjacentMatches,
  DEFAULT_TOKEN_BUDGETS,
  type PatternMatch,
  type PatternType,
  type PatternDef,
  type LLMProvider,
  type ExtractionResult,
  type ExtractedClaim,
  type ExtractedEntity,
  type ExtractorConfig,
  type ExtractorContext,
  type ExtractionProgram,
  type ExtractorRegistry,
  type PatternMatchResult,
  type TokenBudget,
} from './extractors';

// Store
export { createProgramStore, type ProgramStoreInstance } from './store';

// Corrections
export {
  CorrectionService,
  createCorrectionService,
  parseCorrections,
  applyCorrections,
  type ProcessTextResult,
  type CorrectionServiceConfig,
  type ParsedCorrection,
  type CorrectionParseResult,
  type ApplyResult,
} from './corrections';

// Memory Service
export {
  MemoryService,
  createMemoryService,
  createDecayHandler,
} from './memory';

// Migrations
export type { Migration, MigrationResult, MigrationStatus, MigrationRecord } from './migrations';

// Utilities
export { createLogger, type LogLevel } from './utils/logger';
export { generateId } from './utils/id';
export { now, exponentialDecay, SALIENCE_HALFLIFE, HALF_LIFE } from './utils/time';
export { estimateTokens } from './utils/tokens';
