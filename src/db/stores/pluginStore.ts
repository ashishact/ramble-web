import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Plugin, { type PluginType, type PluginTriggers, type PluginLLMConfig } from '../models/Plugin'

const plugins = database.get<Plugin>('plugins')

export const pluginStore = {
  async create(data: {
    name: string
    description: string
    type: PluginType
    triggers?: PluginTriggers
    alwaysRun?: boolean
    promptTemplate?: string
    systemPrompt?: string
    outputSchema?: Record<string, unknown>
    llmTier?: string
    llmConfig?: PluginLLMConfig
    isCore?: boolean
  }): Promise<Plugin> {
    const now = Date.now()
    return await database.write(async () => {
      return await plugins.create((p) => {
        p.name = data.name
        p.description = data.description
        p.type = data.type
        p.version = 1
        p.active = true
        p.triggers = JSON.stringify(data.triggers ?? {})
        p.alwaysRun = data.alwaysRun ?? false
        p.promptTemplate = data.promptTemplate
        p.systemPrompt = data.systemPrompt
        p.outputSchema = data.outputSchema ? JSON.stringify(data.outputSchema) : undefined
        p.llmTier = data.llmTier
        p.llmConfig = data.llmConfig ? JSON.stringify(data.llmConfig) : undefined
        p.runCount = 0
        p.successCount = 0
        p.avgProcessingTimeMs = 0
        p.isCore = data.isCore ?? false
        p.createdAt = now
        p.updatedAt = now
      })
    })
  },

  async getById(id: string): Promise<Plugin | null> {
    try {
      return await plugins.find(id)
    } catch {
      return null
    }
  },

  async getByName(name: string): Promise<Plugin | null> {
    const results = await plugins
      .query(Q.where('name', name), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getByType(type: PluginType): Promise<Plugin[]> {
    return await plugins
      .query(Q.where('type', type), Q.sortBy('name', Q.asc))
      .fetch()
  },

  async getActive(): Promise<Plugin[]> {
    return await plugins
      .query(Q.where('active', true), Q.sortBy('name', Q.asc))
      .fetch()
  },

  async getActiveByType(type: PluginType): Promise<Plugin[]> {
    return await plugins
      .query(
        Q.where('active', true),
        Q.where('type', type),
        Q.sortBy('name', Q.asc)
      )
      .fetch()
  },

  async getAll(): Promise<Plugin[]> {
    return await plugins.query(Q.sortBy('name', Q.asc)).fetch()
  },

  async setActive(id: string, active: boolean): Promise<void> {
    try {
      const plugin = await plugins.find(id)
      await database.write(async () => {
        await plugin.update((p) => {
          p.active = active
          p.updatedAt = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async recordRun(id: string, success: boolean, processingTimeMs: number): Promise<void> {
    try {
      const plugin = await plugins.find(id)
      await database.write(async () => {
        await plugin.update((p) => {
          p.runCount += 1
          if (success) p.successCount += 1
          // Rolling average
          p.avgProcessingTimeMs = (p.avgProcessingTimeMs * (p.runCount - 1) + processingTimeMs) / p.runCount
          p.lastUsed = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    name?: string
    description?: string
    triggers?: PluginTriggers
    alwaysRun?: boolean
    promptTemplate?: string
    systemPrompt?: string
    outputSchema?: Record<string, unknown>
    llmTier?: string
    llmConfig?: PluginLLMConfig
  }): Promise<Plugin | null> {
    try {
      const plugin = await plugins.find(id)
      await database.write(async () => {
        await plugin.update((p) => {
          if (data.name !== undefined) p.name = data.name
          if (data.description !== undefined) p.description = data.description
          if (data.triggers !== undefined) p.triggers = JSON.stringify(data.triggers)
          if (data.alwaysRun !== undefined) p.alwaysRun = data.alwaysRun
          if (data.promptTemplate !== undefined) p.promptTemplate = data.promptTemplate
          if (data.systemPrompt !== undefined) p.systemPrompt = data.systemPrompt
          if (data.outputSchema !== undefined) p.outputSchema = JSON.stringify(data.outputSchema)
          if (data.llmTier !== undefined) p.llmTier = data.llmTier
          if (data.llmConfig !== undefined) p.llmConfig = JSON.stringify(data.llmConfig)
          p.version += 1
          p.updatedAt = Date.now()
        })
      })
      return plugin
    } catch {
      return null
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const plugin = await plugins.find(id)
      // Don't allow deleting core plugins
      if (plugin.isCore) return false
      await database.write(async () => {
        await plugin.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  async getStats(): Promise<{
    total: number
    active: number
    byType: Record<PluginType, number>
    totalRuns: number
    avgSuccessRate: number
  }> {
    const all = await this.getAll()
    const byType: Record<PluginType, number> = {
      extractor: 0,
      observer: 0,
      validator: 0,
    }
    let totalRuns = 0
    let totalSuccess = 0

    for (const p of all) {
      byType[p.type] = (byType[p.type] || 0) + 1
      totalRuns += p.runCount
      totalSuccess += p.successCount
    }

    return {
      total: all.length,
      active: all.filter(p => p.active).length,
      byType,
      totalRuns,
      avgSuccessRate: totalRuns > 0 ? totalSuccess / totalRuns : 0,
    }
  },
}
