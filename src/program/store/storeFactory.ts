/**
 * Store Factory
 *
 * Creates the appropriate store implementation based on configuration.
 * Supports multiple backends: TinyBase (legacy) and WatermelonDB (default)
 */

import type { IProgramStore } from '../interfaces/store'

export type StoreBackend = 'watermelon' | 'tinybase'

export interface StoreConfig {
  backend: StoreBackend
  debug?: boolean
}

const DEFAULT_CONFIG: StoreConfig = {
  backend: 'watermelon',
  debug: false,
}

/**
 * Create a program store with the specified backend
 */
export async function createProgramStore(config?: Partial<StoreConfig>): Promise<IProgramStore> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  switch (finalConfig.backend) {
    case 'watermelon': {
      const { createWatermelonProgramStore } = await import('../../db/stores/watermelonProgramStore')
      const store = createWatermelonProgramStore()
      await store.initialize()
      return store
    }

    case 'tinybase': {
      // TinyBase implementation needs to be updated to async
      // For now, throw an error indicating it's not yet migrated
      throw new Error(
        'TinyBase backend is not yet migrated to async interfaces. ' +
        'Please use WatermelonDB (default) or help migrate TinyBase to async.'
      )

      // TODO: Once TinyBase is migrated to async:
      // const { createTinyBaseProgramStore } = await import('./programStore')
      // const store = createTinyBaseProgramStore()
      // await store.initialize()
      // return store
    }

    default:
      throw new Error(`Unknown store backend: ${finalConfig.backend}`)
  }
}

/**
 * Get the configured backend (for debugging/info)
 */
export function getConfiguredBackend(): StoreBackend {
  // Could read from env var or config file
  return (process.env.VITE_STORE_BACKEND as StoreBackend) || 'watermelon'
}
