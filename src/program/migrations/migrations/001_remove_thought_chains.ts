/**
 * Migration 001: Remove Thought Chains
 *
 * Removes the thought_chains and chain_claims tables and related data
 */

import type { Migration, MigrationResult } from '../types';
import type { ProgramStoreInstance } from '../../store/programStore';

export const migration001: Migration = {
  version: 1,
  name: 'remove_thought_chains',
  description: 'Remove thought_chains and chain_claims tables, clear thought_chain_id from claims',

  async up(store: ProgramStoreInstance): Promise<MigrationResult> {
    const errors: string[] = [];
    let itemsAffected = 0;

    try {
      console.log(`[Migration 001] Removing thought_chains system...`);

      // 3. Delete all chain_claims entries (if table exists)
      try {
        const tinybaseStore = (store as any).getTinyBaseStore?.();
        if (tinybaseStore) {
          // Get all chain_claims
          const chainClaimsTable = tinybaseStore.getTable('chain_claims');
          if (chainClaimsTable) {
            const chainClaimIds = Object.keys(chainClaimsTable);
            console.log(`[Migration 001] Deleting ${chainClaimIds.length} chain_claims entries`);

            for (const id of chainClaimIds) {
              tinybaseStore.delRow('chain_claims', id);
              itemsAffected++;
            }
          }

          // 4. Delete all chains
          const chainsTable = tinybaseStore.getTable('chains');
          if (chainsTable) {
            const chainIds = Object.keys(chainsTable);
            console.log(`[Migration 001] Deleting ${chainIds.length} chains`);

            for (const id of chainIds) {
              tinybaseStore.delRow('chains', id);
              itemsAffected++;
            }
          }
        }
      } catch (error) {
        errors.push(`Failed to delete tables: ${error}`);
      }

      console.log(`[Migration 001] Complete - ${itemsAffected} items affected, ${errors.length} errors`);

      return {
        success: errors.length === 0,
        itemsAffected,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        itemsAffected,
        errors: [errorMessage],
      };
    }
  },

  // No rollback - thought chains are being removed permanently
  down: undefined,
};
