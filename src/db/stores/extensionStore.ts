/**
 * Extension Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IExtensionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Extension, CreateExtension, UpdateExtension, ExtensionType, ExtensionStatus } from '../../program/types'
import ExtensionModel from '../models/Extension'

export function createExtensionStore(db: Database): IExtensionStore {
  const collection = db.get<ExtensionModel>('extensions')

  return {
    async getById(id: string): Promise<Extension | null> {
      try {
        const model = await collection.find(id)
        return modelToExtension(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Extension[]> {
      const models = await collection.query().fetch()
      return models.map(modelToExtension)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateExtension): Promise<Extension> {
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((extension) => {
          extension.extensionType = data.extensionType
          extension.name = data.name
          extension.description = data.description
          extension.configJson = data.configJson
          extension.systemPrompt = data.systemPrompt
          extension.userPromptTemplate = data.userPromptTemplate
          extension.variablesSchemaJson = data.variablesSchemaJson
          extension.llmTier = data.llmTier ?? 'small'
          extension.status = data.status ?? 'draft'
          extension.version = data.version ?? 1
          extension.createdAt = now
          extension.verifiedAt = data.verifiedAt ?? null
        })
      )
      return modelToExtension(model)
    },

    async update(id: string, data: UpdateExtension): Promise<Extension | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((extension) => {
            if (data.name !== undefined) extension.name = data.name
            if (data.description !== undefined) extension.description = data.description
            if (data.configJson !== undefined) extension.configJson = data.configJson
            if (data.systemPrompt !== undefined) extension.systemPrompt = data.systemPrompt
            if (data.userPromptTemplate !== undefined) extension.userPromptTemplate = data.userPromptTemplate
            if (data.variablesSchemaJson !== undefined) extension.variablesSchemaJson = data.variablesSchemaJson
            if (data.llmTier !== undefined) extension.llmTier = data.llmTier
            if (data.status !== undefined) extension.status = data.status
            if (data.version !== undefined) extension.version = data.version
            if (data.verifiedAt !== undefined) extension.verifiedAt = data.verifiedAt ?? null
          })
        )
        return modelToExtension(updated)
      } catch {
        return null
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        const model = await collection.find(id)
        await db.write(() => model.destroyPermanently())
        return true
      } catch {
        return false
      }
    },

    async getByType(type: ExtensionType): Promise<Extension[]> {
      const models = await collection.query(Q.where('extensionType', type)).fetch()
      return models.map(modelToExtension)
    },

    async getByStatus(status: ExtensionStatus): Promise<Extension[]> {
      const models = await collection.query(Q.where('status', status)).fetch()
      return models.map(modelToExtension)
    },

    async getProduction(): Promise<Extension[]> {
      const models = await collection.query(Q.where('status', 'production')).fetch()
      return models.map(modelToExtension)
    },

    async verify(id: string): Promise<Extension | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((extension) => {
            extension.status = 'verified'
          })
        )
        return modelToExtension(updated)
      } catch {
        return null
      }
    },

    subscribe(callback: SubscriptionCallback<Extension>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToExtension))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToExtension(model: ExtensionModel): Extension {
  return {
    id: model.id,
    extensionType: model.extensionType as ExtensionType,
    name: model.name,
    description: model.description,
    configJson: model.configJson,
    systemPrompt: model.systemPrompt,
    userPromptTemplate: model.userPromptTemplate,
    variablesSchemaJson: model.variablesSchemaJson,
    llmTier: model.llmTier as 'small' | 'medium' | 'large',
    status: model.status as ExtensionStatus,
    version: model.version,
    createdAt: model.createdAt,
    verifiedAt: model.verifiedAt ?? null,
  }
}
