// === Node Types (re-export from model for convenience) ===
export type { NodeType, NodeSource, NodeVerification } from '../../db/models/KnowledgeNode'

// === Tree Editor Response ===

export interface TreeEditorResponse {
  actions: CurationAction[]
  searchTerms: string[] | null  // LLM requests deeper tree exploration
}

// --- Content Actions ---

export interface EditAction {
  type: 'edit'
  node: string                    // short ID (n1, n2, ...)
  content?: string                // new full content
  summary?: string                // new summary
  memoryIds?: string[]            // memory short IDs to append
}

export interface CreateAction {
  type: 'create'
  parent: string                  // short ID of parent node
  label: string
  content: string
  summary: string
  nodeType?: string               // default: 'text'
  memoryIds: string[]
  insertAfter?: string            // short ID of sibling (null = end)
}

export interface DeleteAction {
  type: 'delete'
  node: string
  reason: string
}

// --- Structural Actions ---

export interface MoveAction {
  type: 'move'
  node: string
  newParent: string
  insertAfter?: string
}

export interface MergeAction {
  type: 'merge'
  source: string                  // node to merge FROM (will be deleted)
  target: string                  // node to merge INTO (will be kept)
  mergedContent: string
  mergedSummary: string
}

export interface RenameAction {
  type: 'rename'
  node: string
  label: string
}

export interface SplitAction {
  type: 'split'
  node: string
  into: Array<{
    label: string
    content: string
    summary: string
    memoryIds: string[]
  }>
}

// --- Stub Actions (Phase 4, implement handler as no-op with log) ---

export interface RetypeAction {
  type: 'retype'
  node: string
  nodeType: string
  content?: string
}

export interface LinkAction {
  type: 'link'
  fromNode: string
  toEntity: string
  toNode?: string
  relationship: string
}

export interface VerifyAction {
  type: 'verify'
  node: string
  verification: string
  reason?: string
}

// --- Control ---

export interface SkipAction {
  type: 'skip'
  reason: string
}

export type CurationAction =
  | EditAction       // Phase 2 — implement
  | CreateAction     // Phase 2 — implement
  | DeleteAction     // Phase 2 — implement
  | MoveAction       // Phase 2 — implement
  | MergeAction      // Phase 2 — implement
  | RenameAction     // Phase 2 — implement
  | SplitAction      // Phase 2 — implement
  | RetypeAction     // Phase 4 — stub (log + skip)
  | LinkAction       // Phase 4 — stub (log + skip)
  | VerifyAction     // Phase 4 — stub (log + skip)
  | SkipAction       // Phase 2 — implement

// === Templates ===

export interface TemplateNode {
  key: string               // stable identifier, e.g. "identity.role"
  label: string
  nodeType: string
  children?: TemplateNode[]
}

export interface TreeTemplate {
  type: string              // matches entity.type
  nodes: TemplateNode[]
}

// === Short ID Mapping ===

export interface ShortIdMap {
  toShort: Map<string, string>    // real ID → short ID
  toReal: Map<string, string>     // short ID → real ID
  nextIndex: Record<string, number>  // prefix → next counter (e: 1, n: 1, m: 1, etc.)
}
