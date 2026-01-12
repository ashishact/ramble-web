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
export { default as ExtractionLog } from './ExtractionLog'

// Re-export types
export type { ConversationSource, Speaker } from './Conversation'
export type { TaskStatus } from './Task'
export type { GoalStatus } from './Goal'
export type { PluginType, PluginTriggers, PluginLLMConfig } from './Plugin'
