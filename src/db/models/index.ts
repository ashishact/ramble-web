/**
 * WatermelonDB Models Export
 *
 * Core Loop Architecture:
 * - CORE: Session, Conversation, Task
 * - KNOWLEDGE: Entity, Topic, Memory, Goal
 * - SYSTEM: Plugin, Correction, ExtractionLog
 */

// Core
export { default as Session } from './Session'
export { default as Conversation } from './Conversation'
export { default as Task } from './Task'

// Knowledge
export { default as Entity } from './Entity'
export { default as Topic } from './Topic'
export { default as Memory } from './Memory'
export { default as Goal } from './Goal'

// System
export { default as Plugin } from './Plugin'
export { default as Correction } from './Correction'
export { default as LearnedCorrection } from './LearnedCorrection'
export { default as ExtractionLog } from './ExtractionLog'

// Data storage
export { default as Data } from './Data'

// Widget records (generic on-demand widget storage)
export { default as WidgetRecord } from './WidgetRecord'

// Recordings + uploaded files (unified pipeline v7)
export { default as Recording } from './Recording'
export { default as UploadedFile } from './UploadedFile'

// Knowledge tree (v9)
export { default as KnowledgeNode } from './KnowledgeNode'
export { default as EntityCooccurrence } from './EntityCooccurrence'
export { default as TimelineEvent } from './TimelineEvent'

// Re-export types
export type { ConversationSource, Speaker } from './Conversation'
export type { TaskStatus } from './Task'
export type { GoalStatus } from './Goal'
export type { PluginType, PluginTriggers, PluginLLMConfig } from './Plugin'
export type { DataType, OnboardingData, UserProfileData } from './Data'
export type { UploadedFileStatus } from './UploadedFile'
export type { NodeType, NodeSource, NodeVerification } from './KnowledgeNode'
