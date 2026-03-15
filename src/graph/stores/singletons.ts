/**
 * Graph Store Singletons — Lazy accessors for class-based stores
 *
 * EntityStore, TopicStore, MemoryStore, GoalStore all need a
 * ReactiveGraphService instance. This module provides async getters
 * that lazily create them, following the same pattern as graphMutations.
 */

import { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import { getGraphService } from '../index'
import { EntityStore } from './entityStore'
import { TopicStore } from './topicStore'
import { MemoryStore } from './memoryStore'
import { GoalStore } from './goalStore'

let _reactive: ReactiveGraphService | null = null

async function getReactive(): Promise<ReactiveGraphService> {
  if (!_reactive) {
    const graph = await getGraphService()
    _reactive = new ReactiveGraphService(graph)
  }
  return _reactive
}

let _entity: EntityStore | null = null
let _topic: TopicStore | null = null
let _memory: MemoryStore | null = null
let _goal: GoalStore | null = null

export async function getEntityStore(): Promise<EntityStore> {
  if (!_entity) _entity = new EntityStore(await getReactive())
  return _entity
}

export async function getTopicStore(): Promise<TopicStore> {
  if (!_topic) _topic = new TopicStore(await getReactive())
  return _topic
}

export async function getMemoryStore(): Promise<MemoryStore> {
  if (!_memory) _memory = new MemoryStore(await getReactive())
  return _memory
}

export async function getGoalStore(): Promise<GoalStore> {
  if (!_goal) _goal = new GoalStore(await getReactive())
  return _goal
}
