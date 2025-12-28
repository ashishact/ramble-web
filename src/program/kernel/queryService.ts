/**
 * Query Service
 *
 * Handles all read-only queries to the store
 */

import type { IProgramStore } from '../interfaces/store'
import type { GoalManager } from '../goals/goalManager'
import type {
  Claim,
  Entity,
  Goal,
  ConversationUnit,
  Contradiction,
  Pattern,
  ExtractionProgramRecord,
  ObserverProgram,
} from '../types'

export class QueryService {
  private store: IProgramStore
  private goalManager: GoalManager

  constructor(store: IProgramStore, goalManager: GoalManager) {
    this.store = store
    this.goalManager = goalManager
  }

  // ==========================================================================
  // Claims
  // ==========================================================================

  async getClaims(limit?: number): Promise<Claim[]> {
    // Use getRecent() which returns claims sorted by createdAt DESC (newest first)
    return this.store.claims.getRecent(limit ?? 100)
  }

  async getClaimCount(): Promise<number> {
    return this.store.claims.count()
  }

  async getClaimsByType(type: string): Promise<Claim[]> {
    return this.store.claims.getByType(type as Claim['claimType'])
  }

  // ==========================================================================
  // Entities
  // ==========================================================================

  async getEntities(): Promise<Entity[]> {
    // Use getRecent() which returns entities sorted by lastReferenced DESC (most recent first)
    return this.store.entities.getRecent(100)
  }

  // ==========================================================================
  // Goals
  // ==========================================================================

  async getGoals(): Promise<Goal[]> {
    return this.store.goals.getAll()
  }

  async getGoalTree() {
    return this.goalManager.buildGoalTree()
  }

  // ==========================================================================
  // Patterns & Contradictions
  // ==========================================================================

  async getPatterns(): Promise<Pattern[]> {
    return this.store.observerOutputs.getPatterns()
  }

  async getContradictions(): Promise<Contradiction[]> {
    return this.store.observerOutputs.getContradictions()
  }

  // ==========================================================================
  // Conversations
  // ==========================================================================

  async getConversations(): Promise<ConversationUnit[]> {
    return this.store.conversations.getAll()
  }

  // ==========================================================================
  // Tasks
  // ==========================================================================

  async getTasks() {
    // TODO: Need to add tasks store to IProgramStore interface
    // return this.store.tasks.getAll()
    return []
  }

  // ==========================================================================
  // Programs
  // ==========================================================================

  async getExtractionPrograms(): Promise<ExtractionProgramRecord[]> {
    return this.store.extractionPrograms.getAll()
  }

  async getObserverPrograms(): Promise<ObserverProgram[]> {
    return this.store.observerPrograms.getAll()
  }

  // ==========================================================================
  // Store Access
  // ==========================================================================

  getStore(): IProgramStore {
    return this.store
  }
}

export function createQueryService(
  store: IProgramStore,
  goalManager: GoalManager
): QueryService {
  return new QueryService(store, goalManager)
}
