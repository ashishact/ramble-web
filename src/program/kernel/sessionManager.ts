/**
 * Session Manager
 *
 * Handles session lifecycle and state management
 */

import type { IProgramStore } from '../interfaces/store'
import type { Session } from '../types'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

const logger = createLogger('SessionManager')

export class SessionManager {
  private store: IProgramStore
  private activeSession: Session | null = null

  constructor(store: IProgramStore) {
    this.store = store
  }

  /**
   * Initialize and check for existing active session
   */
  async initialize(): Promise<void> {
    this.activeSession = await this.store.sessions.getActive()
    if (this.activeSession) {
      logger.info('Found active session', { sessionId: this.activeSession.id })
    }
  }

  /**
   * Start a new session
   */
  async startSession(_metadata?: Record<string, unknown>): Promise<Session> {
    // End existing session if any
    if (this.activeSession) {
      await this.endSession()
    }

    const session = await this.store.sessions.create({
      startedAt: now(),
      endedAt: null,
      unitCount: 0,
      summary: null,
      moodTrajectoryJson: null,
    })

    this.activeSession = session
    logger.info('Started new session', { sessionId: session.id })

    return session
  }

  /**
   * End the current session
   */
  async endSession(): Promise<void> {
    if (!this.activeSession) {
      logger.warn('No active session to end')
      return
    }

    const sessionId = this.activeSession.id
    await this.store.sessions.endSession(sessionId)
    this.activeSession = null

    logger.info('Ended session', { sessionId })
  }

  /**
   * Get the active session
   */
  getActiveSession(): Session | null {
    return this.activeSession
  }

  /**
   * Ensure there is an active session
   */
  ensureActiveSession(): void {
    if (!this.activeSession) {
      throw new Error('No active session. Call startSession() first.')
    }
  }

  /**
   * Increment unit count for active session
   */
  async incrementUnitCount(): Promise<void> {
    if (!this.activeSession) return
    await this.store.sessions.incrementUnitCount(this.activeSession.id)
  }
}

export function createSessionManager(store: IProgramStore): SessionManager {
  return new SessionManager(store)
}
