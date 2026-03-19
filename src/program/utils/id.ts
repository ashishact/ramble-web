/**
 * ID Generation Utilities
 *
 * Central nanoid-based ID generator for the entire codebase.
 * Format: {prefix}-{6-char alphanumeric}  e.g. "e-uxf9g6"
 *
 * Every subsystem imports `nid` instead of rolling its own IDs.
 * With 36^6 ≈ 2.17 billion possibilities per prefix, collision
 * probability stays negligible for personal knowledge graphs.
 */

import { customAlphabet } from 'nanoid'

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
const nanoid = customAlphabet(alphabet, 6)

/**
 * Generate a short prefixed ID.
 *
 *   nid('e')  → "e-k4x9m2"
 *   nid('br') → "br-a7f3q1"
 */
export function nid(prefix: string): string {
  return `${prefix}-${nanoid()}`
}

/**
 * Typed ID generators for every entity type.
 *
 * Usage: `nid.entity()` → "e-k4x9m2"
 */
nid.entity       = () => nid('e')
nid.memory       = () => nid('m')
nid.goal         = () => nid('g')
nid.topic        = () => nid('t')
nid.session      = () => nid('s')
nid.conversation = () => nid('c')
nid.recording    = () => nid('r')
nid.batch        = () => nid('b')
nid.edge         = () => nid('x')
nid.snapshot     = () => nid('sn')
nid.event        = () => nid('ev')
nid.branch       = () => nid('br')
nid.embedding    = () => nid('em')
nid.chat         = () => nid('ch')
nid.request      = () => nid('rq')
nid.telemetry    = () => nid('tm')
nid.llm          = () => nid('lm')
nid.run          = () => nid('rn')
nid.widget       = () => nid('w')

/**
 * Fast djb2 string hash — returns a short hex string.
 * Used for dedup keys, cache keys, etc. NOT cryptographic.
 */
export function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
