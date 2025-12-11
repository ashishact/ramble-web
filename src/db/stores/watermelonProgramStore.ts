/**
 * WatermelonDB Program Store
 *
 * Implements IProgramStore interface using WatermelonDB stores
 */

import type { Database } from '@nozbe/watermelondb'
import type { IProgramStore } from '../../program/interfaces/store'
import { database } from '../database'
import {
  createSessionStore,
  createConversationStore,
  createClaimStore,
  createSourceTrackingStore,
  createEntityStore,
  createGoalStore,
  createExtractionProgramStore,
  createObserverProgramStore,
  createObserverOutputStore,
  createExtensionStore,
  createSynthesisCacheStore,
  createCorrectionStore,
} from './index'

export class WatermelonProgramStore implements IProgramStore {
  private db: Database
  private ready: boolean = false

  // Store instances
  public readonly sessions
  public readonly conversations
  public readonly claims
  public readonly sourceTracking
  public readonly entities
  public readonly goals
  public readonly observerOutputs
  public readonly extensions
  public readonly synthesisCache
  public readonly extractionPrograms
  public readonly observerPrograms
  public readonly corrections

  constructor(db: Database = database) {
    this.db = db

    // Initialize all stores
    this.sessions = createSessionStore(db)
    this.conversations = createConversationStore(db)
    this.claims = createClaimStore(db)
    this.sourceTracking = createSourceTrackingStore(db)
    this.entities = createEntityStore(db)
    this.goals = createGoalStore(db)
    this.observerOutputs = createObserverOutputStore(db)
    this.extensions = createExtensionStore(db)
    this.synthesisCache = createSynthesisCacheStore(db)
    this.extractionPrograms = createExtractionProgramStore(db)
    this.observerPrograms = createObserverProgramStore(db)
    this.corrections = createCorrectionStore(db)
  }

  async initialize(): Promise<void> {
    // WatermelonDB initializes on import, but we can do any setup here
    this.ready = true
  }

  isReady(): boolean {
    return this.ready
  }

  async ensureReady(): Promise<void> {
    if (!this.ready) {
      await this.initialize()
    }
  }
}

/**
 * Create a new WatermelonDB-backed program store
 */
export function createWatermelonProgramStore(db?: Database): WatermelonProgramStore {
  return new WatermelonProgramStore(db)
}
