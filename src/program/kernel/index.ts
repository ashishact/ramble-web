/**
 * Kernel Module
 *
 * Re-exports kernel functionality.
 */

export {
  ProgramKernel,
  getKernel,
  resetKernel,
  type KernelConfig,
  type KernelState,
  type KernelStats,
} from './kernel';

// Re-export search service types
export { type SearchResult, type ReplaceResult } from './searchService';
