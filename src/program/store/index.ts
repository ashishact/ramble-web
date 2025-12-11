/**
 * Program Store
 *
 * Re-exports all store implementations.
 */

import { createWatermelonProgramStore, WatermelonProgramStore } from '../../db/stores/watermelonProgramStore';
import type { IProgramStore } from '../interfaces/store';

// Use WatermelonDB implementation
export const createProgramStore = createWatermelonProgramStore;

// Create singleton instance
let _programStore: WatermelonProgramStore | null = null;
export const programStore = {
  get(): WatermelonProgramStore {
    if (!_programStore) {
      _programStore = createWatermelonProgramStore();
    }
    return _programStore;
  },
};

// Type alias for backwards compatibility
export type ProgramStoreInstance = IProgramStore;
