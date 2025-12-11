/**
 * Sync Service
 *
 * Syncs code-based extractors and observers to database.
 * Code is the source of truth for configuration, DB stores runtime state (active flag).
 */

import type { ProgramStoreInstance } from '../store';
import type { Observer } from '../observers/types';
import { extractorRegistry } from '../extractors/registry';
import { createLogger } from '../utils/logger';

const logger = createLogger('Sync');

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  extractorsAdded: number;
  extractorsUpdated: number;
  observersAdded: number;
  observersUpdated: number;
}

// ============================================================================
// Extractor Sync
// ============================================================================

/**
 * Sync all registered extractors from code to database
 */
export async function syncExtractors(store: ProgramStoreInstance): Promise<SyncResult> {
  logger.info('Starting extractor sync...');

  const result: SyncResult = {
    extractorsAdded: 0,
    extractorsUpdated: 0,
    observersAdded: 0,
    observersUpdated: 0,
  };

  const codeExtractors = extractorRegistry.getAll();

  for (const extractor of codeExtractors) {
    const config = extractor.config;
    const dbRecord = await store.extractionPrograms.getById(config.id);

    if (dbRecord) {
      // Record exists - only update if configuration changed (but keep active state)
      // For now, we just ensure the record exists and keep the active state
      logger.debug('Extractor already in DB', { id: config.id, active: dbRecord.active });
      result.extractorsUpdated++;
    } else {
      // Create new record from code configuration
      logger.info('Adding new extractor to DB', { id: config.id, name: config.name });

      try {
        await store.extractionPrograms.create({
          id: config.id,  // Use code-defined ID for lookups
          name: config.name,
          description: config.description,
          type: config.claimTypes[0] || 'general',
          version: 1,
          patternsJson: JSON.stringify(config.patterns),
          alwaysRun: config.alwaysRun || false,
          llmTier: config.llmTier,
          llmTemperature: config.llmOptions?.temperature ?? 0,
          llmMaxTokens: config.llmOptions?.maxTokens ?? 0,
          promptTemplate: '',
          outputSchemaJson: JSON.stringify({}),
          priority: config.priority,
          active: true,
          minConfidence: config.minConfidence,
          isCore: true,
          claimTypesJson: JSON.stringify(config.claimTypes),
          successRate: 0,
          runCount: 0,
          avgProcessingTimeMs: 0,
        });

        result.extractorsAdded++;
      } catch (error) {
        // Handle duplicate key error gracefully
        if (error instanceof Error && error.message.includes('Duplicate')) {
          logger.debug('Extractor already exists (duplicate key)', { id: config.id });
          result.extractorsUpdated++;
        } else {
          throw error;
        }
      }
    }
  }

  logger.info('Extractor sync complete', {
    added: result.extractorsAdded,
    updated: result.extractorsUpdated,
  });

  return result;
}

// ============================================================================
// Observer Sync
// ============================================================================

/**
 * Sync all registered observers from dispatcher to database
 */
export async function syncObservers(
  store: ProgramStoreInstance,
  observers: Map<string, Observer>
): Promise<SyncResult> {
  logger.info('Starting observer sync...');

  const result: SyncResult = {
    extractorsAdded: 0,
    extractorsUpdated: 0,
    observersAdded: 0,
    observersUpdated: 0,
  };

  for (const [observerType, observer] of observers.entries()) {
    const config = observer.config;
    const dbRecord = await store.observerPrograms.getByType(config.type);

    if (dbRecord) {
      // Record exists - keep the active state from DB
      logger.debug('Observer already in DB', { type: observerType, active: dbRecord.active });
      result.observersUpdated++;
    } else {
      // Create new record from code configuration
      logger.info('Adding new observer to DB', { type: observerType, name: config.name });

      try {
        await store.observerPrograms.create({
          name: config.name,
          type: config.type,
          description: config.description,
          active: true,
          priority: config.priority,
          triggers: config.triggers,
          claimTypeFilter: config.claimTypeFilter ? JSON.stringify(config.claimTypeFilter) : null,
          usesLlm: config.usesLLM,
          llmTier: null,  // Code-based observers define their own LLM calls
          llmTemperature: null,
          llmMaxTokens: null,
          promptTemplate: null,
          outputSchemaJson: null,
          shouldRunLogic: null,
          processLogic: null,
          isCore: true,
          version: 1,
          runCount: 0,
          successRate: 0,
          avgProcessingTimeMs: 0,
        });

        result.observersAdded++;
      } catch (error) {
        // Handle duplicate key error gracefully
        if (error instanceof Error && error.message.includes('Duplicate')) {
          logger.debug('Observer already exists (duplicate key)', { type: config.type });
          result.observersUpdated++;
        } else {
          throw error;
        }
      }
    }
  }

  logger.info('Observer sync complete', {
    added: result.observersAdded,
    updated: result.observersUpdated,
  });

  return result;
}

// ============================================================================
// Combined Sync
// ============================================================================

/**
 * Sync both extractors and observers
 */
export async function syncAll(
  store: ProgramStoreInstance,
  observers: Map<string, Observer>
): Promise<SyncResult> {
  logger.info('Starting full sync...');

  const extractorResult = await syncExtractors(store);
  const observerResult = await syncObservers(store, observers);

  const combined: SyncResult = {
    extractorsAdded: extractorResult.extractorsAdded,
    extractorsUpdated: extractorResult.extractorsUpdated,
    observersAdded: observerResult.observersAdded,
    observersUpdated: observerResult.observersUpdated,
  };

  logger.info('Full sync complete', combined);

  return combined;
}
