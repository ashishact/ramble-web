/**
 * Entity Filtering — determines which entities are eligible for tree curation.
 *
 * Used by both the live pipeline (processor.ts) and the backfill service.
 *
 * Rules:
 * 1. User's own entity always qualifies (no mention threshold)
 * 2. Other entities need mentionCount >= 2
 * 3. Generic single-word nouns are excluded (customer, ambassador, etc.)
 */

import { dataStore } from '../../db/stores'

// ============================================================================
// Generic noun blocklist — single-word entities that shouldn't get trees
// ============================================================================

const GENERIC_NOUNS = new Set([
  // Common role/title words
  'customer', 'customers', 'client', 'clients',
  'user', 'users', 'member', 'members',
  'manager', 'managers', 'director', 'directors',
  'ambassador', 'ambassadors', 'representative', 'representatives',
  'employee', 'employees', 'colleague', 'colleagues',
  'partner', 'partners', 'vendor', 'vendors',
  'supplier', 'suppliers', 'investor', 'investors',
  'developer', 'developers', 'engineer', 'engineers',
  'designer', 'designers', 'analyst', 'analysts',
  'consultant', 'consultants', 'advisor', 'advisors',
  'intern', 'interns', 'volunteer', 'volunteers',
  'teacher', 'teachers', 'student', 'students',
  'doctor', 'doctors', 'patient', 'patients',
  // Generic group words
  'team', 'teams', 'group', 'groups',
  'company', 'companies', 'organization', 'organizations',
  'department', 'departments', 'division', 'divisions',
  // Generic concept words
  'meeting', 'meetings', 'project', 'projects',
  'product', 'products', 'service', 'services',
  'system', 'systems', 'platform', 'platforms',
  'process', 'processes', 'program', 'programs',
  'thing', 'things', 'stuff', 'item', 'items',
  'everyone', 'someone', 'anyone', 'nobody',
  'people', 'person', 'guy', 'guys',
])

function isGenericNoun(name: string): boolean {
  // Only filter single-word entities — multi-word names like "Customer Service Team" are fine
  const trimmed = name.trim()
  if (trimmed.includes(' ')) return false
  return GENERIC_NOUNS.has(trimmed.toLowerCase())
}

// ============================================================================
// User entity detection (cached)
// ============================================================================

let cachedUserName: string | null | undefined = undefined

async function getUserName(): Promise<string | null> {
  if (cachedUserName !== undefined) return cachedUserName
  const profile = await dataStore.getUserProfile()
  cachedUserName = profile?.name?.trim() ?? null
  return cachedUserName
}

function isUserEntity(entityName: string, userName: string): boolean {
  const entityLower = entityName.toLowerCase()
  const userLower = userName.toLowerCase()
  // Exact match or the entity name is contained in the user's full name
  // e.g. "Ashish" matches "Ashish Charan Tandi"
  return entityLower === userLower || userLower.includes(entityLower) || entityLower.includes(userLower)
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if an entity is eligible for tree curation.
 *
 * @returns true if the entity should get a knowledge tree
 */
export async function isEligibleForTree(entity: {
  name: string
  mentionCount: number
}): Promise<boolean> {
  // Filter out generic nouns regardless of mention count
  if (isGenericNoun(entity.name)) return false

  // User's own entity always qualifies
  const userName = await getUserName()
  if (userName && isUserEntity(entity.name, userName)) return true

  // Other entities need mentionCount >= 2
  return entity.mentionCount >= 2
}

/**
 * Filter a list of entities to only those eligible for tree curation.
 */
export async function filterEligibleEntities<T extends { name: string; mentionCount: number }>(
  entities: T[]
): Promise<T[]> {
  const results: T[] = []
  for (const entity of entities) {
    if (await isEligibleForTree(entity)) {
      results.push(entity)
    }
  }
  return results
}
