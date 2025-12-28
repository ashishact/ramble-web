/**
 * Primitive Extractor
 *
 * Unified extractor that extracts all Layer 1 primitives in a SINGLE LLM call:
 * - Propositions (what is said, stripped of modality)
 * - Stances (how propositions are held - epistemic, volitional, deontic, affective)
 * - Relations (how propositions connect)
 * - EntityMentions (raw text references - "he", "John", "my boss")
 *
 * Spans are computed via pattern matching BEFORE the LLM call.
 * Entity resolution (Layer 2) happens after this extraction.
 */

import type {
  CreateProposition,
  CreateStance,
  CreateRelation,
  CreateEntityMention,
  Epistemic,
  Volitional,
  Deontic,
  Affective,
  PropositionType,
  RelationCategory,
  MentionType,
  SuggestedEntityType,
} from '../schemas/primitives'
import {
  DEFAULT_EPISTEMIC,
  DEFAULT_VOLITIONAL,
  DEFAULT_DEONTIC,
  DEFAULT_AFFECTIVE,
} from '../schemas/primitives'
import { callLLM } from '../pipeline/llmClient'
import type { LLMTier } from '../types/llmTiers'

// ============================================================================
// Types
// ============================================================================

export interface PrimitiveExtractionInput {
  /** The utterance to process */
  utterance: {
    id: string
    rawText: string
    sessionId: string
    timestamp: number
    speaker: 'user' | 'agent'
  }
  /** Pattern matches (spans computed before LLM) */
  spans: Array<{
    id: string
    charStart: number
    charEnd: number
    textExcerpt: string
    patternId?: string
  }>
  /** Known entities for context */
  knownEntities: Array<{
    id: string
    canonicalName: string
    type: string
    aliases: string[]
  }>
  /** Recent propositions for relation detection */
  recentPropositions?: Array<{
    id: string
    content: string
    subject: string
  }>
  /** LLM tier to use */
  llmTier?: LLMTier
}

export interface PrimitiveExtractionOutput {
  propositions: CreateProposition[]
  stances: CreateStance[]
  relations: CreateRelation[]
  entityMentions: CreateEntityMention[]  // Layer 1: raw mentions
  metadata: {
    model: string
    tokensUsed: number
    processingTimeMs: number
    /** LLM prompt sent (for debug tracing) */
    llmPrompt: string
    /** Raw LLM response (for debug tracing) */
    llmResponse: string
  }
}

// Raw LLM output structure
interface RawEpistemic {
  certainty?: number
  evidence?: string
}

interface RawVolitional {
  valence?: number
  strength?: number
  type?: string
}

interface RawDeontic {
  strength?: number
  source?: string
  type?: string
}

interface RawAffective {
  valence?: number
  arousal?: number
  emotions?: string[]
}

interface RawStance {
  epistemic?: RawEpistemic
  volitional?: RawVolitional
  deontic?: RawDeontic
  affective?: RawAffective
}

interface RawProposition {
  content: string
  subject: string
  type: string
  entityRefs?: string[] // References to entity names
  stance?: RawStance
  spanIndices?: number[] // Indices into the spans array
}

interface RawRelation {
  sourceIndex: number // Index into propositions array
  targetIndex: number
  category: string
  subtype: string
  strength: number
  spanIndices?: number[]
}

// Layer 1: Raw entity mention (not yet resolved)
interface RawEntityMention {
  text: string              // The raw text: "he", "John", "my boss"
  mentionType: string       // pronoun, proper_noun, common_noun, definite_description, self_reference
  suggestedType: string     // person, organization, project, etc.
  spanIndex?: number        // Index into spans array
}

interface RawLLMOutput {
  propositions: RawProposition[]
  relations?: RawRelation[]
  entityMentions: RawEntityMention[]  // Changed from entities
}

// ============================================================================
// Main Extractor
// ============================================================================

/**
 * Extract all primitives from an utterance in a single LLM call
 */
export async function extractPrimitives(
  input: PrimitiveExtractionInput
): Promise<PrimitiveExtractionOutput> {
  const startTime = Date.now()
  const now = Date.now()

  // Build the prompt
  const prompt = buildPrompt(input)

  // Call LLM
  const response = await callLLM({
    tier: input.llmTier || 'small',
    prompt,
  })

  // Parse response
  const parsed = parseResponse(response.content)

  // Convert to proper types with generated IDs
  const result = convertToOutput(parsed, input, now)

  return {
    ...result,
    metadata: {
      model: response.model,
      tokensUsed: response.tokens_used.total,
      processingTimeMs: Date.now() - startTime,
      llmPrompt: prompt,
      llmResponse: response.content,
    },
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildPrompt(input: PrimitiveExtractionInput): string {
  const spansContext = input.spans.length > 0
    ? `\n<matched_spans>\n${input.spans.map((s, i) => `[${i}] "${s.textExcerpt}" (chars ${s.charStart}-${s.charEnd})`).join('\n')}\n</matched_spans>`
    : ''

  const entitiesContext = input.knownEntities.length > 0
    ? `\n<known_entities>\n${input.knownEntities.map(e => `- ${e.canonicalName} (${e.type})${e.aliases.length > 0 ? ` aliases: ${e.aliases.join(', ')}` : ''}`).join('\n')}\n</known_entities>`
    : ''

  const recentContext = input.recentPropositions && input.recentPropositions.length > 0
    ? `\n<recent_propositions>\n${input.recentPropositions.slice(0, 5).map((p, i) => `[R${i}] ${p.content}`).join('\n')}\n</recent_propositions>`
    : ''

  return `You are an expert at extracting structured mental representations from speech.

Your task is to extract PROPOSITIONS, their STANCES, and any ENTITIES from the input.

## What to Extract

### PROPOSITIONS
A proposition is the core content of what is said, STRIPPED of how it's said.
- Remove modal markers: "I think", "I believe", "maybe", "probably"
- Keep the factual content: "The project is behind schedule" not "I think the project might be behind schedule"
- Each distinct claim = one proposition

Proposition types:
- "state": Current states ("The sky is blue")
- "event": Past/future events ("I went to the store")
- "process": Ongoing activities ("I'm learning to code")
- "hypothetical": Conditionals ("If I had more time...")
- "generic": General truths ("Dogs are loyal")

### STANCES
Stances capture HOW the proposition is held. Each proposition has one stance with 4 dimensions:

1. EPISTEMIC (certainty about truth):
   - certainty: 0-1 (0=uncertain, 1=certain)
   - evidence: "direct" (speaker witnessed), "inferred" (deduced), "hearsay" (told by others), "assumption" (just assumed)

2. VOLITIONAL (desire toward the proposition):
   - valence: -1 to 1 (negative=averse, positive=wanting)
   - strength: 0-1 (how strongly)
   - type: "want", "intend", "hope", "fear", "prefer" (optional)

3. DEONTIC (obligation/permission):
   - strength: 0-1 (0=no obligation, 1=absolute must)
   - source: "self" (self-imposed), "other" (external), "circumstance" (optional)
   - type: "must", "should", "may", "mustNot" (optional)

4. AFFECTIVE (emotional coloring):
   - valence: -1 to 1 (negative to positive)
   - arousal: 0-1 (calm to excited)
   - emotions: array of specific emotions (optional)

### ENTITY MENTIONS
Extract ALL references to entities, including:
- Pronouns: "he", "she", "it", "they", "I", "you", "we"
- Proper nouns: "John", "Google", "Paris"
- Common nouns: "my boss", "the project", "a friend"
- Definite descriptions: "the CEO", "the first one"
- Self-references: "I", "me", "myself"

For each mention, identify:
- mentionType: "pronoun" | "proper_noun" | "common_noun" | "definite_description" | "self_reference"
- suggestedType: what kind of entity ("person", "organization", "project", "artifact", "event", "concept", "place", "self")

We will resolve these to canonical entities later. Just extract what you see.

### RELATIONS (if multiple propositions)
How propositions connect:
- "causal": X causes Y (subtypes: "because", "therefore", "leads_to")
- "temporal": X before/after Y (subtypes: "before", "after", "during", "then")
- "logical": X implies/contradicts Y (subtypes: "implies", "contradicts", "supports")
- "teleological": X is for purpose Y (subtypes: "in_order_to", "for", "to_achieve")
- "contrastive": X but Y (subtypes: "but", "however", "although")
- "conditional": If X then Y (subtypes: "if_then", "unless", "when")
${spansContext}
${entitiesContext}
${recentContext}

<input speaker="${input.utterance.speaker}">
${input.utterance.rawText}
</input>

Respond with JSON only, no other text:
{
  "propositions": [
    {
      "content": "The core claim without modality",
      "subject": "Main entity this is about",
      "type": "state|event|process|hypothetical|generic",
      "entityRefs": ["Entity Name 1", "Entity Name 2"],
      "stance": {
        "epistemic": { "certainty": 0.0-1.0, "evidence": "direct|inferred|hearsay|assumption" },
        "volitional": { "valence": -1.0-1.0, "strength": 0.0-1.0, "type": "want|intend|hope|fear|prefer" },
        "deontic": { "strength": 0.0-1.0, "source": "self|other|circumstance", "type": "must|should|may|mustNot" },
        "affective": { "valence": -1.0-1.0, "arousal": 0.0-1.0, "emotions": ["emotion1", "emotion2"] }
      },
      "spanIndices": [0, 1]
    }
  ],
  "relations": [
    {
      "sourceIndex": 0,
      "targetIndex": 1,
      "category": "causal|temporal|logical|teleological|contrastive|conditional",
      "subtype": "because|therefore|before|after|implies|etc",
      "strength": 0.0-1.0
    }
  ],
  "entityMentions": [
    {
      "text": "he",
      "mentionType": "pronoun|proper_noun|common_noun|definite_description|self_reference",
      "suggestedType": "person|organization|project|artifact|event|concept|place|self",
      "spanIndex": 0
    }
  ]
}

IMPORTANT:
- Only include stance dimensions that are clearly expressed. Use defaults otherwise.
- spanIndices reference the matched_spans by index (if any match this proposition)
- Extract ALL entity mentions, including pronouns like "he", "she", "it", "I"
- Return empty arrays if nothing found, not null
- For self-references ("I", "me"), use mentionType "self_reference" and suggestedType "self"`
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseResponse(response: string): RawLLMOutput {
  let jsonStr = response.trim()

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1]
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    jsonStr = objectMatch[0]
  }

  try {
    const parsed = JSON.parse(jsonStr)
    return {
      propositions: Array.isArray(parsed.propositions) ? parsed.propositions : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      entityMentions: Array.isArray(parsed.entityMentions) ? parsed.entityMentions : [],
    }
  } catch (error) {
    console.error('[PrimitiveExtractor] Failed to parse response:', error)
    console.error('Response was:', response.slice(0, 500))
    return { propositions: [], relations: [], entityMentions: [] }
  }
}

// ============================================================================
// Output Conversion
// ============================================================================

function convertToOutput(
  raw: RawLLMOutput,
  input: PrimitiveExtractionInput,
  now: number
): Omit<PrimitiveExtractionOutput, 'metadata'> {
  // Generate temp IDs for propositions (will be replaced by store)
  const propIdMap = new Map<number, string>()

  // Convert propositions
  const propositions: CreateProposition[] = raw.propositions.map((p, i) => {
    const tempId = `prop_${now}_${i}`
    propIdMap.set(i, tempId)

    // Map entityRefs to entity IDs from known entities or new entities
    const entityIds: string[] = []
    if (p.entityRefs) {
      for (const ref of p.entityRefs) {
        const known = input.knownEntities.find(
          e => e.canonicalName.toLowerCase() === ref.toLowerCase() ||
               e.aliases.some(a => a.toLowerCase() === ref.toLowerCase())
        )
        if (known) {
          entityIds.push(known.id)
        }
        // New entities will be linked after they're created
      }
    }

    // Map spanIndices to span IDs
    const spanIds = (p.spanIndices || [])
      .filter(i => i >= 0 && i < input.spans.length)
      .map(i => input.spans[i].id)

    return {
      content: p.content || '',
      subject: p.subject || 'unknown',
      type: normalizePropositionType(p.type),
      entityIds,
      spanIds,
      conversationId: input.utterance.id,
      createdAt: now,
    }
  })

  // Convert stances (one per proposition)
  const stances: CreateStance[] = raw.propositions.map((p, i) => {
    const propId = propIdMap.get(i)!
    const s = p.stance || {}

    return {
      propositionId: propId, // Will need to be updated after proposition is saved
      holder: 'speaker',
      epistemic: normalizeEpistemic(s.epistemic),
      volitional: normalizeVolitional(s.volitional),
      deontic: normalizeDeontic(s.deontic),
      affective: normalizeAffective(s.affective),
      expressedAt: now,
    }
  })

  // Convert relations
  const relations: CreateRelation[] = (raw.relations || [])
    .filter(r =>
      r.sourceIndex >= 0 && r.sourceIndex < raw.propositions.length &&
      r.targetIndex >= 0 && r.targetIndex < raw.propositions.length
    )
    .map(r => ({
      sourceId: propIdMap.get(r.sourceIndex)!,
      targetId: propIdMap.get(r.targetIndex)!,
      category: normalizeRelationCategory(r.category),
      subtype: r.subtype || 'unspecified',
      strength: clamp(r.strength ?? 0.5, 0, 1),
      spanIds: (r.spanIndices || [])
        .filter(i => i >= 0 && i < input.spans.length)
        .map(i => input.spans[i].id),
      createdAt: now,
    }))

  // Convert entity mentions (Layer 1 - raw text references)
  const entityMentions: CreateEntityMention[] = raw.entityMentions.map(m => ({
    text: m.text || '',
    mentionType: normalizeMentionType(m.mentionType),
    suggestedType: normalizeSuggestedEntityType(m.suggestedType),
    spanId: m.spanIndex !== undefined && m.spanIndex >= 0 && m.spanIndex < input.spans.length
      ? input.spans[m.spanIndex].id
      : input.spans[0]?.id || '',
    conversationId: input.utterance.id,
    createdAt: now,
    // resolvedEntityId is filled in by Layer 2 entity resolver
  }))

  return { propositions, stances, relations, entityMentions }
}

// ============================================================================
// Normalization Helpers
// ============================================================================

function normalizePropositionType(type: string | undefined): PropositionType {
  const valid = ['state', 'event', 'process', 'hypothetical', 'generic']
  return valid.includes(type || '') ? (type as PropositionType) : 'state'
}

function normalizeRelationCategory(category: string | undefined): RelationCategory {
  const valid = ['causal', 'temporal', 'logical', 'teleological', 'compositional', 'contrastive', 'conditional']
  return valid.includes(category || '') ? (category as RelationCategory) : 'logical'
}

function normalizeMentionType(type: string | undefined): MentionType {
  const valid = ['pronoun', 'proper_noun', 'common_noun', 'definite_description', 'self_reference']
  return valid.includes(type || '') ? (type as MentionType) : 'common_noun'
}

function normalizeSuggestedEntityType(type: string | undefined): SuggestedEntityType {
  const valid = ['person', 'organization', 'project', 'artifact', 'event', 'concept', 'place', 'self']
  return valid.includes(type || '') ? (type as SuggestedEntityType) : 'concept'
}

function normalizeEpistemic(e: RawEpistemic | undefined): Epistemic {
  if (!e) return DEFAULT_EPISTEMIC
  const validEvidence = ['direct', 'inferred', 'hearsay', 'assumption']
  return {
    certainty: clamp(e.certainty ?? 0.5, 0, 1),
    evidence: validEvidence.includes(e.evidence || '') ? (e.evidence as Epistemic['evidence']) : 'inferred',
  }
}

function normalizeVolitional(v: RawVolitional | undefined): Volitional {
  if (!v) return DEFAULT_VOLITIONAL
  const validTypes = ['want', 'intend', 'hope', 'fear', 'prefer']
  return {
    valence: clamp(v.valence ?? 0, -1, 1),
    strength: clamp(v.strength ?? 0, 0, 1),
    type: validTypes.includes(v.type || '') ? (v.type as Volitional['type']) : undefined,
  }
}

function normalizeDeontic(d: RawDeontic | undefined): Deontic {
  if (!d) return DEFAULT_DEONTIC
  const validSources = ['self', 'other', 'circumstance']
  const validTypes = ['must', 'should', 'may', 'mustNot']
  return {
    strength: clamp(d.strength ?? 0, 0, 1),
    source: validSources.includes(d.source || '') ? (d.source as Deontic['source']) : undefined,
    type: validTypes.includes(d.type || '') ? (d.type as Deontic['type']) : undefined,
  }
}

function normalizeAffective(a: RawAffective | undefined): Affective {
  if (!a) return DEFAULT_AFFECTIVE
  return {
    valence: clamp(a.valence ?? 0, -1, 1),
    arousal: clamp(a.arousal ?? 0, 0, 1),
    emotions: Array.isArray(a.emotions) ? a.emotions.filter((em): em is string => typeof em === 'string') : undefined,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
