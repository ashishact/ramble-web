/**
 * Program Types
 *
 * TypeScript types derived from Zod schemas.
 * Using z.infer<> ensures types stay in sync with runtime validation.
 */

import { z } from 'zod';
import {
  // Session
  SessionSchema,
  CreateSessionSchema,
  UpdateSessionSchema,

  // Conversation
  ConversationSourceSchema,
  ConversationUnitSchema,
  CreateConversationUnitSchema,
  UpdateConversationUnitSchema,

  // Claims
  ClaimTypeSchema,
  TemporalitySchema,
  AbstractionSchema,
  SourceTypeSchema,
  ClaimStateSchema,
  StakesSchema,
  ClaimSchema,
  CreateClaimSchema,
  UpdateClaimSchema,
  ClaimSourceSchema,
  CreateClaimSourceSchema,

  // Entities
  EntityTypeSchema,
  EntitySchema,
  CreateEntitySchema,
  UpdateEntitySchema,

  // Thought Chains
  ChainStateSchema,
  ThoughtChainSchema,
  CreateThoughtChainSchema,
  UpdateThoughtChainSchema,
  ChainClaimSchema,
  CreateChainClaimSchema,

  // Goals
  GoalTypeSchema,
  GoalTimeframeSchema,
  GoalStatusSchema,
  ProgressTypeSchema,
  BlockerTypeSchema,
  BlockerSeveritySchema,
  BlockerStatusSchema,
  MilestoneStatusSchema,
  GoalSchema,
  CreateGoalSchema,
  UpdateGoalSchema,
  MilestoneSchema,
  BlockerSchema,

  // Tasks
  TaskTypeSchema,
  TaskStatusSchema,
  TaskPrioritySchema,
  BackoffConfigSchema,
  TaskCheckpointSchema,
  TaskSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  ExtractFromUnitPayloadSchema,
  RunExtractorPayloadSchema,
  SaveExtractionResultsPayloadSchema,
  RunObserverPayloadSchema,
  ConsolidateMemoryPayloadSchema,
  CheckChainDormancyPayloadSchema,
  GenerateSessionSummaryPayloadSchema,
  DecayClaimsPayloadSchema,
  CheckGoalProgressPayloadSchema,
  InferGoalHierarchyPayloadSchema,
  GenerateSynthesisPayloadSchema,
  ProcessChainUpdatesPayloadSchema,

  // Observers
  ObserverTypeSchema,
  TriggerTypeSchema,
  ObserverTriggerSchema,
  ObserverOutputSchema,
  CreateObserverOutputSchema,
  UpdateObserverOutputSchema,
  ContradictionSchema,
  CreateContradictionSchema,
  PatternSchema,
  CreatePatternSchema,
  ValueSchema,
  CreateValueSchema,

  // Extensions
  ExtensionTypeSchema,
  ExtensionStatusSchema,
  ExtensionSchema,
  CreateExtensionSchema,
  UpdateExtensionSchema,

  // Synthesis Cache
  SynthesisCacheSchema,
  CreateSynthesisCacheSchema,
  UpdateSynthesisCacheSchema,

  // Extraction Programs
  ExtractionProgramSchema,
  CreateExtractionProgramSchema,
  UpdateExtractionProgramSchema,
} from '../schemas';

// ============================================================================
// Session Types
// ============================================================================

export type Session = z.infer<typeof SessionSchema>;
export type CreateSession = z.infer<typeof CreateSessionSchema>;
export type UpdateSession = z.infer<typeof UpdateSessionSchema>;

// ============================================================================
// Conversation Types
// ============================================================================

export type ConversationSource = z.infer<typeof ConversationSourceSchema>;
export type ConversationUnit = z.infer<typeof ConversationUnitSchema>;
export type CreateConversationUnit = z.infer<typeof CreateConversationUnitSchema>;
export type UpdateConversationUnit = z.infer<typeof UpdateConversationUnitSchema>;

// ============================================================================
// Claim Types
// ============================================================================

export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export type Temporality = z.infer<typeof TemporalitySchema>;
export type Abstraction = z.infer<typeof AbstractionSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type ClaimState = z.infer<typeof ClaimStateSchema>;
export type Stakes = z.infer<typeof StakesSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type CreateClaim = z.infer<typeof CreateClaimSchema>;
export type UpdateClaim = z.infer<typeof UpdateClaimSchema>;
export type ClaimSource = z.infer<typeof ClaimSourceSchema>;
export type CreateClaimSource = z.infer<typeof CreateClaimSourceSchema>;

// ============================================================================
// Entity Types
// ============================================================================

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type CreateEntity = z.infer<typeof CreateEntitySchema>;
export type UpdateEntity = z.infer<typeof UpdateEntitySchema>;

// ============================================================================
// Thought Chain Types
// ============================================================================

export type ChainState = z.infer<typeof ChainStateSchema>;
export type ThoughtChain = z.infer<typeof ThoughtChainSchema>;
export type CreateThoughtChain = z.infer<typeof CreateThoughtChainSchema>;
export type UpdateThoughtChain = z.infer<typeof UpdateThoughtChainSchema>;
export type ChainClaim = z.infer<typeof ChainClaimSchema>;
export type CreateChainClaim = z.infer<typeof CreateChainClaimSchema>;

// ============================================================================
// Goal Types
// ============================================================================

export type GoalType = z.infer<typeof GoalTypeSchema>;
export type GoalTimeframe = z.infer<typeof GoalTimeframeSchema>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type ProgressType = z.infer<typeof ProgressTypeSchema>;
export type BlockerType = z.infer<typeof BlockerTypeSchema>;
export type BlockerSeverity = z.infer<typeof BlockerSeveritySchema>;
export type BlockerStatus = z.infer<typeof BlockerStatusSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type CreateGoal = z.infer<typeof CreateGoalSchema>;
export type UpdateGoal = z.infer<typeof UpdateGoalSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Blocker = z.infer<typeof BlockerSchema>;

// ============================================================================
// Task Types
// ============================================================================

export type TaskType = z.infer<typeof TaskTypeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type BackoffConfig = z.infer<typeof BackoffConfigSchema>;
export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

// Task Payloads
export type ExtractFromUnitPayload = z.infer<typeof ExtractFromUnitPayloadSchema>;
export type RunExtractorPayload = z.infer<typeof RunExtractorPayloadSchema>;
export type SaveExtractionResultsPayload = z.infer<typeof SaveExtractionResultsPayloadSchema>;
export type RunObserverPayload = z.infer<typeof RunObserverPayloadSchema>;
export type ConsolidateMemoryPayload = z.infer<typeof ConsolidateMemoryPayloadSchema>;
export type CheckChainDormancyPayload = z.infer<typeof CheckChainDormancyPayloadSchema>;
export type GenerateSessionSummaryPayload = z.infer<typeof GenerateSessionSummaryPayloadSchema>;
export type DecayClaimsPayload = z.infer<typeof DecayClaimsPayloadSchema>;
export type CheckGoalProgressPayload = z.infer<typeof CheckGoalProgressPayloadSchema>;
export type InferGoalHierarchyPayload = z.infer<typeof InferGoalHierarchyPayloadSchema>;
export type GenerateSynthesisPayload = z.infer<typeof GenerateSynthesisPayloadSchema>;
export type ProcessChainUpdatesPayload = z.infer<typeof ProcessChainUpdatesPayloadSchema>;

// ============================================================================
// Observer Types
// ============================================================================

export type ObserverType = z.infer<typeof ObserverTypeSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type ObserverTrigger = z.infer<typeof ObserverTriggerSchema>;
export type ObserverOutput = z.infer<typeof ObserverOutputSchema>;
export type CreateObserverOutput = z.infer<typeof CreateObserverOutputSchema>;
export type UpdateObserverOutput = z.infer<typeof UpdateObserverOutputSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>;
export type CreateContradiction = z.infer<typeof CreateContradictionSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type CreatePattern = z.infer<typeof CreatePatternSchema>;
export type Value = z.infer<typeof ValueSchema>;
export type CreateValue = z.infer<typeof CreateValueSchema>;

// ============================================================================
// Extension Types
// ============================================================================

export type ExtensionType = z.infer<typeof ExtensionTypeSchema>;
export type ExtensionStatus = z.infer<typeof ExtensionStatusSchema>;
export type Extension = z.infer<typeof ExtensionSchema>;
export type CreateExtension = z.infer<typeof CreateExtensionSchema>;
export type UpdateExtension = z.infer<typeof UpdateExtensionSchema>;

// ============================================================================
// Synthesis Cache Types
// ============================================================================

export type SynthesisCache = z.infer<typeof SynthesisCacheSchema>;
export type CreateSynthesisCache = z.infer<typeof CreateSynthesisCacheSchema>;
export type UpdateSynthesisCache = z.infer<typeof UpdateSynthesisCacheSchema>;

// ============================================================================
// Extraction Program Types
// ============================================================================

export type ExtractionProgram = z.infer<typeof ExtractionProgramSchema>;
export type CreateExtractionProgram = z.infer<typeof CreateExtractionProgramSchema>;
export type UpdateExtractionProgram = z.infer<typeof UpdateExtractionProgramSchema>;
