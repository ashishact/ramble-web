/**
 * Graph Data Layer — Public API
 *
 * The single import point for all data access in the UI.
 * Every widget reads and writes through these exports.
 *
 * Reading:
 *   import { useGraphData, useGraphCounts, useConversationData } from '@/graph/data'
 *
 *   const { data } = useGraphData<EntityItem>('entity', { limit: 50 })
 *   const { counts } = useGraphCounts(['entity', 'topic', 'memory', 'goal'])
 *   const { data: convos } = useConversationData({ limit: 20 })
 *
 * Writing:
 *   import { graphMutations } from '@/graph/data'
 *
 *   await graphMutations.createNode(['entity', 'person'], { name: 'Alice' })
 *   await graphMutations.updateNodeProperties(id, { description: 'Updated' })
 *   await graphMutations.deleteNode(id)
 */

// Hooks
export { useGraphData } from './useGraphData'
export { useGraphCounts, useConversationCount } from './useGraphCounts'
export { useConversationData } from './useConversationData'

// Mutations
export { graphMutations } from './mutations'

// Types
export type {
  GraphDataOptions,
  ConversationDataOptions,
  BaseNodeRecord,
  ConversationRecord,
  EntityItem,
  TopicItem,
  MemoryItem,
  GoalItem,
  KnowledgeNodeItem,
  TimelineEventItem,
  LearnedCorrectionItem,
} from './types'
