/**
 * ID Generation Utilities
 *
 * Generate unique identifiers for various entities in the system.
 */

/**
 * Generate a unique ID using crypto.randomUUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a prefixed ID for better debugging
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateId()}`;
}

/**
 * ID prefixes for different entity types
 */
export const ID_PREFIX = {
  CONVERSATION_UNIT: 'cu',
  CLAIM: 'cl',
  ENTITY: 'en',
  THOUGHT_CHAIN: 'tc',
  GOAL: 'go',
  TASK: 'tk',
  SESSION: 'se',
  OBSERVER_OUTPUT: 'oo',
  CLAIM_SOURCE: 'cs',
  CHAIN_CLAIM: 'cc',
  CONTRADICTION: 'ct',
  VALUE: 'va',
  PATTERN: 'pa',
  MILESTONE: 'mi',
  BLOCKER: 'bl',
  EXTENSION: 'ex',
  SYNTHESIS_CACHE: 'sc',
  EXTRACTION_PROGRAM: 'ep',
  CORRECTION: 'cr',
} as const;

/**
 * Generate IDs for specific entity types
 */
export const id = {
  conversationUnit: () => generatePrefixedId(ID_PREFIX.CONVERSATION_UNIT),
  claim: () => generatePrefixedId(ID_PREFIX.CLAIM),
  entity: () => generatePrefixedId(ID_PREFIX.ENTITY),
  thoughtChain: () => generatePrefixedId(ID_PREFIX.THOUGHT_CHAIN),
  goal: () => generatePrefixedId(ID_PREFIX.GOAL),
  task: () => generatePrefixedId(ID_PREFIX.TASK),
  session: () => generatePrefixedId(ID_PREFIX.SESSION),
  observerOutput: () => generatePrefixedId(ID_PREFIX.OBSERVER_OUTPUT),
  claimSource: () => generatePrefixedId(ID_PREFIX.CLAIM_SOURCE),
  chainClaim: () => generatePrefixedId(ID_PREFIX.CHAIN_CLAIM),
  contradiction: () => generatePrefixedId(ID_PREFIX.CONTRADICTION),
  value: () => generatePrefixedId(ID_PREFIX.VALUE),
  pattern: () => generatePrefixedId(ID_PREFIX.PATTERN),
  milestone: () => generatePrefixedId(ID_PREFIX.MILESTONE),
  blocker: () => generatePrefixedId(ID_PREFIX.BLOCKER),
  extension: () => generatePrefixedId(ID_PREFIX.EXTENSION),
  synthesisCache: () => generatePrefixedId(ID_PREFIX.SYNTHESIS_CACHE),
  extractionProgram: () => generatePrefixedId(ID_PREFIX.EXTRACTION_PROGRAM),
  correction: () => generatePrefixedId(ID_PREFIX.CORRECTION),
};
