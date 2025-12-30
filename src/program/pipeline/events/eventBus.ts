/**
 * Pipeline Event Bus
 *
 * RxJS-based event bus for pipeline coordination.
 * Events are emitted AFTER saves complete to ensure durability.
 */

import { Subject, Observable, filter, Subscription } from 'rxjs';
import type {
  PipelineEvent,
  PipelineEventType,
  UnitCreatedPayload,
  UnitPreprocessedPayload,
  PrimitivesExtractedPayload,
  EntitiesResolvedPayload,
  ClaimsDerivedPayload,
  ObserversCompletedPayload,
  UnitCompletedPayload,
} from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('EventBus');

// ============================================================================
// Event Bus Implementation
// ============================================================================

/**
 * Central event bus for pipeline coordination
 */
export class PipelineEventBus {
  private subject = new Subject<PipelineEvent>();
  private subscriptions: Subscription[] = [];
  private eventHistory: PipelineEvent[] = [];
  private maxHistorySize = 100;

  constructor() {
    // Log all events for debugging
    this.subscriptions.push(
      this.subject.subscribe((event) => {
        logger.debug('Event emitted', {
          type: event.type,
          correlationId: event.correlationId,
        });

        // Keep recent history for debugging
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistorySize) {
          this.eventHistory.shift();
        }
      })
    );
  }

  /**
   * Emit an event
   * IMPORTANT: Only call this AFTER saving to DB
   */
  emit<T>(
    type: PipelineEventType,
    correlationId: string,
    payload: T
  ): void {
    const event: PipelineEvent<T> = {
      type,
      timestamp: Date.now(),
      correlationId,
      payload,
    };

    logger.info('Emitting event', {
      type,
      correlationId,
      payloadKeys: Object.keys(payload as object),
    });

    this.subject.next(event);
  }

  /**
   * Subscribe to specific event types
   */
  on<T>(eventType: PipelineEventType): Observable<PipelineEvent<T>> {
    return this.subject.pipe(
      filter((e): e is PipelineEvent<T> => e.type === eventType)
    );
  }

  /**
   * Subscribe to all events (for logging/debugging)
   */
  onAll(): Observable<PipelineEvent> {
    return this.subject.asObservable();
  }

  /**
   * Subscribe to multiple event types
   */
  onAny<T>(eventTypes: PipelineEventType[]): Observable<PipelineEvent<T>> {
    return this.subject.pipe(
      filter((e): e is PipelineEvent<T> => eventTypes.includes(e.type))
    );
  }

  /**
   * Get recent event history (for debugging)
   */
  getHistory(): PipelineEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Get events for a specific correlation ID
   */
  getEventsForUnit(correlationId: string): PipelineEvent[] {
    return this.eventHistory.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Check if an event type has been emitted for a correlation ID
   */
  hasEmitted(correlationId: string, eventType: PipelineEventType): boolean {
    return this.eventHistory.some(
      (e) => e.correlationId === correlationId && e.type === eventType
    );
  }

  /**
   * Cleanup subscriptions
   */
  destroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.subject.complete();
  }
}

// ============================================================================
// Typed Event Emitter Helpers
// ============================================================================

/**
 * Typed helper to emit unit:created event
 */
export function emitUnitCreated(
  bus: PipelineEventBus,
  payload: UnitCreatedPayload
): void {
  bus.emit('unit:created', payload.unitId, payload);
}

/**
 * Typed helper to emit unit:preprocessed event
 */
export function emitUnitPreprocessed(
  bus: PipelineEventBus,
  payload: UnitPreprocessedPayload
): void {
  bus.emit('unit:preprocessed', payload.unitId, payload);
}

/**
 * Typed helper to emit primitives:extracted event
 */
export function emitPrimitivesExtracted(
  bus: PipelineEventBus,
  payload: PrimitivesExtractedPayload
): void {
  bus.emit('primitives:extracted', payload.unitId, payload);
}

/**
 * Typed helper to emit entities:resolved event
 */
export function emitEntitiesResolved(
  bus: PipelineEventBus,
  payload: EntitiesResolvedPayload
): void {
  bus.emit('entities:resolved', payload.unitId, payload);
}

/**
 * Typed helper to emit claims:derived event
 */
export function emitClaimsDerived(
  bus: PipelineEventBus,
  payload: ClaimsDerivedPayload
): void {
  bus.emit('claims:derived', payload.unitId, payload);
}

/**
 * Typed helper to emit observers:*:completed events
 */
export function emitObserversCompleted(
  bus: PipelineEventBus,
  payload: ObserversCompletedPayload
): void {
  const eventType: PipelineEventType =
    payload.observerType === 'nonllm'
      ? 'observers:nonllm:completed'
      : 'observers:llm:completed';
  bus.emit(eventType, payload.unitId, payload);
}

/**
 * Typed helper to emit unit:completed event
 */
export function emitUnitCompleted(
  bus: PipelineEventBus,
  payload: UnitCompletedPayload
): void {
  bus.emit('unit:completed', payload.unitId, payload);
}

// ============================================================================
// Singleton Factory
// ============================================================================

let eventBusInstance: PipelineEventBus | null = null;

/**
 * Get or create the event bus singleton
 */
export function getEventBus(): PipelineEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new PipelineEventBus();
  }
  return eventBusInstance;
}

/**
 * Reset the event bus (for testing)
 */
export function resetEventBus(): void {
  if (eventBusInstance) {
    eventBusInstance.destroy();
    eventBusInstance = null;
  }
}
