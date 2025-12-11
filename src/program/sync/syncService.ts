/**
 * Sync Service
 *
 * Syncs code-based extractors and observers to database.
 * Code is the source of truth for configuration, DB stores runtime state (active flag).
 */

import type { ProgramStoreInstance } from '../store/programStore';
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
export function syncExtractors(store: ProgramStoreInstance): SyncResult {
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
    const dbRecord = store.extractionPrograms.getById(config.id);

    if (dbRecord) {
      // Record exists - only update if configuration changed (but keep active state)
      // For now, we just ensure the record exists and keep the active state
      logger.debug('Extractor already in DB', { id: config.id, active: dbRecord.active });
      result.extractorsUpdated++;
    } else {
      // Create new record from code configuration using setRow to specify ID
      logger.info('Adding new extractor to DB', { id: config.id, name: config.name });

      const timestamp = Date.now();
      store.getStore().setRow('extraction_programs', config.id, {
        name: config.name,
        description: config.description,
        type: config.claimTypes[0] || 'general', // Use first claim type as type
        version: 1,
        patterns_json: JSON.stringify(config.patterns),
        always_run: config.alwaysRun || false,
        llm_tier: config.llmTier, // Tier abstraction (small/medium/large)
        llm_temperature: config.llm_options?.temperature ?? 0,
        llm_max_tokens: config.llm_options?.max_tokens ?? 0,
        prompt_template: '', // Code-based extractors use buildPrompt() method
        output_schema_json: JSON.stringify({}),
        priority: config.priority,
        active: true, // New extractors start active
        min_confidence: config.minConfidence,
        is_core: true, // Code-based extractors are core
        claim_types_json: JSON.stringify(config.claimTypes),
        success_rate: 0,
        run_count: 0,
        avg_processing_time_ms: 0,
        created_at: timestamp,
        updated_at: timestamp,
      });

      result.extractorsAdded++;
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
export function syncObservers(
  store: ProgramStoreInstance,
  observers: Map<string, Observer>
): SyncResult {
  logger.info('Starting observer sync...');

  const result: SyncResult = {
    extractorsAdded: 0,
    extractorsUpdated: 0,
    observersAdded: 0,
    observersUpdated: 0,
  };

  for (const [observerType, observer] of observers.entries()) {
    const config = observer.config;
    const dbRecord = store.observerPrograms.getByType(config.type);

    if (dbRecord) {
      // Record exists - keep the active state from DB
      logger.debug('Observer already in DB', { type: observerType, active: dbRecord.active });
      result.observersUpdated++;
    } else {
      // Create new record from code configuration using setRow to specify ID
      logger.info('Adding new observer to DB', { type: observerType, name: config.name });

      const id = `op_${observerType}`;
      const timestamp = Date.now();
      store.getStore().setRow('observer_programs', id, {
        name: config.name,
        type: config.type,
        description: config.description,
        active: true, // New observers start active
        priority: config.priority,
        triggers: JSON.stringify(config.triggers),
        claim_type_filter: config.claimTypeFilter ? JSON.stringify(config.claimTypeFilter) : '',
        uses_llm: config.usesLLM,
        llm_tier: '', // Code-based observers define their own LLM calls (empty string for no tier)
        llm_temperature: 0,
        llm_max_tokens: 0,
        prompt_template: '', // Code-based observers build prompts programmatically
        output_schema_json: '',
        should_run_logic: '',
        process_logic: '',
        is_core: true, // Code-based observers are core
        version: 1,
        run_count: 0,
        success_rate: 0,
        avg_processing_time_ms: 0,
        created_at: timestamp,
        updated_at: timestamp,
      });

      result.observersAdded++;
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
export function syncAll(
  store: ProgramStoreInstance,
  observers: Map<string, Observer>
): SyncResult {
  logger.info('Starting full sync...');

  const extractorResult = syncExtractors(store);
  const observerResult = syncObservers(store, observers);

  const combined: SyncResult = {
    extractorsAdded: extractorResult.extractorsAdded,
    extractorsUpdated: extractorResult.extractorsUpdated,
    observersAdded: observerResult.observersAdded,
    observersUpdated: observerResult.observersUpdated,
  };

  logger.info('Full sync complete', combined);

  return combined;
}
