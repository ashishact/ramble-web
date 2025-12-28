/**
 * WatermelonDB Program Store
 *
 * Implements IProgramStore interface using WatermelonDB stores
 *
 * Layered Architecture:
 * - Layer 0: Stream (conversations)
 * - Layer 1: Primitives (propositions, stances, relations, spans, entities)
 * - Layer 2: Derived (claims, goals, patterns, values, contradictions)
 */

import type { Database } from '@nozbe/watermelondb'
import type { IProgramStore } from '../../program/interfaces/store'
import { database } from '../database'
import {
  // Layer 0: Stream
  createSessionStore,
  createConversationStore,
  // Layer 1: Primitives
  createPropositionStore,
  createStanceStore,
  createRelationStore,
  createSpanStore,
  createPrimitiveEntityStore,
  createEntityMentionStore,
  createEntityStore,
  // Layer 2: Derived
  createDerivedStore,
  createClaimStore,
  createGoalStore,
  // Observers & Extractors
  createExtractionProgramStore,
  createObserverProgramStore,
  createObserverOutputStore,
  // Support
  createExtensionStore,
  createSynthesisCacheStore,
  createCorrectionStore,
  createTaskStore,
} from './index'

export class WatermelonProgramStore implements IProgramStore {
  private ready: boolean = false

  // Layer 0: Stream
  public readonly sessions
  public readonly conversations

  // Layer 1: Primitives
  public readonly propositions
  public readonly stances
  public readonly relations
  public readonly spans
  public readonly entityMentions
  public readonly primitiveEntities
  public readonly entities

  // Layer 2: Derived
  public readonly derived
  public readonly claims
  public readonly goals
  public readonly observerOutputs

  // Observers & Extractors
  public readonly extractionPrograms
  public readonly observerPrograms

  // Support
  public readonly extensions
  public readonly synthesisCache
  public readonly corrections
  public readonly tasks

  constructor(db: Database = database) {
    // Layer 0: Stream
    this.sessions = createSessionStore(db)
    this.conversations = createConversationStore(db)

    // Layer 1: Primitives
    this.propositions = createPropositionStore(db)
    this.stances = createStanceStore(db)
    this.relations = createRelationStore(db)
    this.spans = createSpanStore(db)
    this.primitiveEntities = createPrimitiveEntityStore(db)
    this.entityMentions = createEntityMentionStore(db)
    this.entities = createEntityStore(db)

    // Layer 2: Derived
    this.derived = createDerivedStore(db)
    this.claims = createClaimStore(db)
    this.goals = createGoalStore(db)
    this.observerOutputs = createObserverOutputStore(db)

    // Observers & Extractors
    this.extractionPrograms = createExtractionProgramStore(db)
    this.observerPrograms = createObserverProgramStore(db)

    // Support
    this.extensions = createExtensionStore(db)
    this.synthesisCache = createSynthesisCacheStore(db)
    this.corrections = createCorrectionStore(db)
    this.tasks = createTaskStore(db)
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
