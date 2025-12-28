/**
 * EntityMention Store - WatermelonDB Implementation
 * Layer 1: Raw entity references in text
 *
 * NOTE: This is a stub implementation. Full WatermelonDB model needs to be created.
 */

import type { Database } from '@nozbe/watermelondb'
import type { IEntityMentionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { EntityMention, CreateEntityMention } from '../../program/schemas/primitives'

// In-memory storage for now (until WatermelonDB model is created)
const inMemoryMentions: Map<string, EntityMention> = new Map()
let idCounter = 0

export function createEntityMentionStore(_db: Database): IEntityMentionStore {
  return {
    async getById(id: string): Promise<EntityMention | null> {
      return inMemoryMentions.get(id) || null
    },

    async getAll(): Promise<EntityMention[]> {
      return Array.from(inMemoryMentions.values())
    },

    async count(): Promise<number> {
      return inMemoryMentions.size
    },

    async create(data: CreateEntityMention): Promise<EntityMention> {
      const id = `mention_${Date.now()}_${idCounter++}`
      const mention: EntityMention = {
        id,
        ...data,
      }
      inMemoryMentions.set(id, mention)
      return mention
    },

    async update(id: string, data: Partial<EntityMention>): Promise<EntityMention | null> {
      const existing = inMemoryMentions.get(id)
      if (!existing) return null

      const updated = { ...existing, ...data }
      inMemoryMentions.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<boolean> {
      return inMemoryMentions.delete(id)
    },

    async getByConversation(conversationId: string): Promise<EntityMention[]> {
      return Array.from(inMemoryMentions.values())
        .filter(m => m.conversationId === conversationId)
    },

    async getByResolvedEntity(entityId: string): Promise<EntityMention[]> {
      return Array.from(inMemoryMentions.values())
        .filter(m => m.resolvedEntityId === entityId)
    },

    async getUnresolved(): Promise<EntityMention[]> {
      return Array.from(inMemoryMentions.values())
        .filter(m => !m.resolvedEntityId)
    },

    async getRecent(limit: number): Promise<EntityMention[]> {
      return Array.from(inMemoryMentions.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
    },

    async resolve(id: string, entityId: string): Promise<EntityMention | null> {
      const existing = inMemoryMentions.get(id)
      if (!existing) return null

      const updated = { ...existing, resolvedEntityId: entityId }
      inMemoryMentions.set(id, updated)
      return updated
    },

    subscribe(_callback: SubscriptionCallback<EntityMention>): Unsubscribe {
      // In-memory doesn't support subscriptions
      return () => {}
    },
  }
}
