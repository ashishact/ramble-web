/**
 * Search Service
 *
 * Global search and replace functionality across all data
 */

import type { IProgramStore } from '../interfaces/store'
import { createLogger } from '../utils/logger'

const logger = createLogger('SearchService')

export interface SearchResult {
  type: 'conversation' | 'claim' | 'entity' | 'goal'
  id: string
  field: string
  value: string
  context: string
}

export interface ReplaceResult {
  conversationsUpdated: number
  claimsUpdated: number
  entitiesUpdated: number
  goalsUpdated: number
  totalReplacements: number
}

export class SearchService {
  private store: IProgramStore

  constructor(store: IProgramStore) {
    this.store = store
  }

  /**
   * Search for text across all stored data (fuzzy search)
   */
  async searchText(query: string, options?: { caseSensitive?: boolean }): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const searchLower = options?.caseSensitive ? query : query.toLowerCase()

    // Search conversations
    const conversations = await this.store.conversations.getAll()
    for (const conv of conversations) {
      const rawLower = options?.caseSensitive ? conv.rawText : conv.rawText.toLowerCase()
      const sanitizedLower = options?.caseSensitive
        ? conv.sanitizedText
        : conv.sanitizedText.toLowerCase()

      if (rawLower.includes(searchLower)) {
        results.push({
          type: 'conversation',
          id: conv.id,
          field: 'rawText',
          value: conv.rawText,
          context: this.getContext(conv.rawText, query, options?.caseSensitive),
        })
      }
      if (sanitizedLower.includes(searchLower) && conv.sanitizedText !== conv.rawText) {
        results.push({
          type: 'conversation',
          id: conv.id,
          field: 'sanitizedText',
          value: conv.sanitizedText,
          context: this.getContext(conv.sanitizedText, query, options?.caseSensitive),
        })
      }
    }

    // Search claims
    const claims = await this.store.claims.getAll()
    for (const claim of claims) {
      const stmtLower = options?.caseSensitive ? claim.statement : claim.statement.toLowerCase()
      const subjLower = options?.caseSensitive ? claim.subject : claim.subject.toLowerCase()

      if (stmtLower.includes(searchLower)) {
        results.push({
          type: 'claim',
          id: claim.id,
          field: 'statement',
          value: claim.statement,
          context: this.getContext(claim.statement, query, options?.caseSensitive),
        })
      }
      if (subjLower.includes(searchLower)) {
        results.push({
          type: 'claim',
          id: claim.id,
          field: 'subject',
          value: claim.subject,
          context: claim.subject,
        })
      }
    }

    // Search entities
    const entities = await this.store.entities.getAll()
    for (const entity of entities) {
      const nameLower = options?.caseSensitive
        ? entity.canonicalName
        : entity.canonicalName.toLowerCase()

      if (nameLower.includes(searchLower)) {
        results.push({
          type: 'entity',
          id: entity.id,
          field: 'canonicalName',
          value: entity.canonicalName,
          context: entity.canonicalName,
        })
      }

      // Check aliases
      if (entity.aliases) {
        try {
          const aliases = JSON.parse(entity.aliases) as string[]
          for (const alias of aliases) {
            const aliasLower = options?.caseSensitive ? alias : alias.toLowerCase()
            if (aliasLower.includes(searchLower)) {
              results.push({
                type: 'entity',
                id: entity.id,
                field: 'aliases',
                value: alias,
                context: `Alias of ${entity.canonicalName}`,
              })
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Search goals
    const goals = await this.store.goals.getAll()
    for (const goal of goals) {
      const stmtLower = options?.caseSensitive ? goal.statement : goal.statement.toLowerCase()

      if (stmtLower.includes(searchLower)) {
        results.push({
          type: 'goal',
          id: goal.id,
          field: 'statement',
          value: goal.statement,
          context: this.getContext(goal.statement, query, options?.caseSensitive),
        })
      }
    }

    return results
  }

  /**
   * Replace text across all stored data
   */
  async replaceText(
    searchText: string,
    replaceText: string,
    options?: { caseSensitive?: boolean }
  ): Promise<ReplaceResult> {
    const result: ReplaceResult = {
      conversationsUpdated: 0,
      claimsUpdated: 0,
      entitiesUpdated: 0,
      goalsUpdated: 0,
      totalReplacements: 0,
    }

    const createRegex = () =>
      new RegExp(
        searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options?.caseSensitive ? 'g' : 'gi'
      )

    // Replace in conversations
    const conversations = await this.store.conversations.getAll()
    for (const conv of conversations) {
      const regex = createRegex()
      if (regex.test(conv.rawText)) {
        const newRaw = conv.rawText.replace(createRegex(), replaceText)
        await this.store.conversations.update(conv.id, { rawText: newRaw })
        result.conversationsUpdated++
        result.totalReplacements += (conv.rawText.match(createRegex()) || []).length
      }

      const regex2 = createRegex()
      if (regex2.test(conv.sanitizedText)) {
        const newSanitized = conv.sanitizedText.replace(createRegex(), replaceText)
        await this.store.conversations.update(conv.id, { sanitizedText: newSanitized })
        if (!createRegex().test(conv.rawText)) {
          result.conversationsUpdated++
        }
        result.totalReplacements += (conv.sanitizedText.match(createRegex()) || []).length
      }
    }

    // Replace in claims
    const claims = await this.store.claims.getAll()
    for (const claim of claims) {
      let updated = false
      const updates: { statement?: string; subject?: string } = {}

      const regex1 = createRegex()
      if (regex1.test(claim.statement)) {
        updates.statement = claim.statement.replace(createRegex(), replaceText)
        result.totalReplacements += (claim.statement.match(createRegex()) || []).length
        updated = true
      }

      const regex2 = createRegex()
      if (regex2.test(claim.subject)) {
        updates.subject = claim.subject.replace(createRegex(), replaceText)
        result.totalReplacements += (claim.subject.match(createRegex()) || []).length
        updated = true
      }

      if (updated) {
        await this.store.claims.update(claim.id, updates)
        result.claimsUpdated++
      }
    }

    // Replace in entities
    const entities = await this.store.entities.getAll()
    for (const entity of entities) {
      let updated = false
      const updates: { canonicalName?: string; aliases?: string } = {}

      const regex1 = createRegex()
      if (regex1.test(entity.canonicalName)) {
        updates.canonicalName = entity.canonicalName.replace(createRegex(), replaceText)
        result.totalReplacements += (entity.canonicalName.match(createRegex()) || []).length
        updated = true
      }

      if (entity.aliases) {
        try {
          const aliases = JSON.parse(entity.aliases) as string[]
          const newAliases = aliases.map((alias) => {
            const regex = createRegex()
            if (regex.test(alias)) {
              result.totalReplacements += (alias.match(createRegex()) || []).length
              updated = true
              return alias.replace(createRegex(), replaceText)
            }
            return alias
          })
          if (updated) {
            updates.aliases = JSON.stringify(newAliases)
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (updated) {
        await this.store.entities.update(entity.id, updates)
        result.entitiesUpdated++
      }
    }

    // Replace in goals
    const goals = await this.store.goals.getAll()
    for (const goal of goals) {
      const regex = createRegex()
      if (regex.test(goal.statement)) {
        const newStatement = goal.statement.replace(createRegex(), replaceText)
        await this.store.goals.update(goal.id, { statement: newStatement })
        result.goalsUpdated++
        result.totalReplacements += (goal.statement.match(createRegex()) || []).length
      }
    }

    logger.info('Global replace completed', result)
    return result
  }

  /**
   * Get context snippet around a match
   */
  private getContext(text: string, query: string, caseSensitive?: boolean): string {
    const lowerText = caseSensitive ? text : text.toLowerCase()
    const lowerQuery = caseSensitive ? query : query.toLowerCase()
    const index = lowerText.indexOf(lowerQuery)
    if (index === -1) return text.slice(0, 60)

    const start = Math.max(0, index - 20)
    const end = Math.min(text.length, index + query.length + 20)
    let context = text.slice(start, end)
    if (start > 0) context = '...' + context
    if (end < text.length) context = context + '...'
    return context
  }
}

export function createSearchService(store: IProgramStore): SearchService {
  return new SearchService(store)
}
