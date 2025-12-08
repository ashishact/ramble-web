# RAMBLE: Revised System Design Document

## Core Philosophy (Unchanged)

**No embeddings. No vector databases. Just text, time, and programs.**

The system is built on three principles:
1. Raw data is sacred and immutable
2. Structure emerges through deterministic programs, not statistical similarity
3. LLMs extract and synthesize, they don't search

---

## System Architecture Overview (Revised)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│    SPEECH ──► SANITIZER ──► RAW STORE ──► EXTRACTION PIPELINE ──►           │
│                                │                    │                        │
│                                │                    ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   PROGRAM RUNNER    │            │
│                                │         │   (Pattern Match +   │            │
│                                │         │    Relevance Score)  │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   TOKEN BUDGET      │            │
│                                │         │   MANAGER           │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   LLM EXTRACTOR     │            │
│                                │         │   (JSON Output)     │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │            CLAIM STORE ◄───────────        │
│                                │                   │            │           │
│                                │                   ▼            │           │
│                                │         ┌─────────────────┐    │           │
│                                │         │ MEMORY SYSTEM   │    │           │
│                                │         │ ├─ Episodic     │    │           │
│                                │         │ ├─ Working      │    │           │
│                                │         │ └─ Long-term    │    │           │
│                                │         └─────────────────┘    │           │
│                                │                   │            │           │
│                                │                   ▼            │           │
│                                │      ┌────────────────────┐    │           │
│                                │      │  DURABLE QUEUE     │    │           │
│                                │      │  (IndexedDB-backed)│    │           │
│                                │      └─────────┬──────────┘    │           │
│                                │                │               │           │
│                                │                ▼               │           │
│                                │           OBSERVERS ───────────┘           │
│                                │                │                           │
│                                ▼                ▼                           │
│                         AGENTIC SEARCH ◄──── READ QUERIES                   │
│                                │                                            │
│                                ▼                                            │
│                    ┌─────────────────────────┐                              │
│                    │  EXTENSION REGISTRY     │                              │
│                    │  (View Synthesizers,    │                              │
│                    │   Custom Extractors)    │                              │
│                    └─────────────────────────┘                              │
│                                │                                            │
│                                ▼                                            │
│                        NOVEL SYNTHESIS                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Data Store (IndexedDB + TinyBase)

### Store Structure

TinyBase organizes data into Tables, Rows, and Cells. Here's the schema:

```typescript
// TinyBase Store Schema

interface RambleStore {
  tables: {
    // Raw conversation units - immutable
    conversation_units: {
      [id: string]: {
        session_id: string;
        timestamp: number; // Unix ms
        raw_text: string;
        sanitized_text: string;
        source: 'speech' | 'text';
        preceding_context_summary: string;
        created_at: number;
        processed: boolean; // Has extraction run?
      }
    };

    // Extracted claims
    claims: {
      [id: string]: {
        statement: string;
        subject: string;
        claim_type: string;
        temporality: string;
        abstraction: string;
        source_type: string;
        initial_confidence: number;
        current_confidence: number;
        state: 'active' | 'stale' | 'dormant' | 'superseded';
        emotional_valence: number;
        emotional_intensity: number;
        stakes: string;
        valid_from: number;
        valid_until: number | null;
        created_at: number;
        last_confirmed: number;
        confirmation_count: number;
        extraction_program_id: string;
        superseded_by: string | null;
        elaborates: string | null;
        thought_chain_id: string | null;
      }
    };

    // Claim to source unit relationships (many-to-many)
    claim_sources: {
      [id: string]: {
        claim_id: string;
        unit_id: string;
      }
    };

    // Entities
    entities: {
      [id: string]: {
        canonical_name: string;
        entity_type: string;
        aliases: string; // JSON array as string
        created_at: number;
        last_referenced: number;
        mention_count: number;
      }
    };

    // Thought chains
    thought_chains: {
      [id: string]: {
        topic: string;
        started_at: number;
        last_extended: number;
        branches_from: string | null;
        state: 'active' | 'dormant' | 'concluded';
      }
    };

    // Chain to claim relationships
    chain_claims: {
      [id: string]: {
        chain_id: string;
        claim_id: string;
        position: number;
      }
    };

    // Extraction programs
    extraction_programs: {
      [id: string]: {
        name: string;
        type: string;
        version: number;
        patterns_json: string; // JSON array
        extraction_prompt: string;
        output_schema_json: string;
        priority: number; // For ordering
        active: boolean;
        is_core: boolean; // Core vs extension
        success_rate: number;
        run_count: number;
        created_at: number;
      }
    };

    // Durable task queue
    task_queue: {
      [id: string]: {
        task_type: string;
        payload_json: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        attempts: number;
        max_attempts: number;
        created_at: number;
        started_at: number | null;
        completed_at: number | null;
        error: string | null;
        priority: number;
      }
    };

    // Observer outputs
    observer_outputs: {
      [id: string]: {
        observer_type: string;
        output_type: string;
        content_json: string;
        source_claims_json: string; // Array of claim IDs
        created_at: number;
        stale: boolean;
      }
    };

    // Goals (first-class entity)
    goals: {
      [id: string]: {
        statement: string;
        type: 'outcome' | 'process' | 'identity' | 'avoidance';
        timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'life';
        status: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'dormant';
        parent_goal_id: string | null;
        created_at: number;
        last_referenced: number;
        priority: number;
        progress_indicators_json: string;
        blockers_json: string;
        source_claim_id: string;
      }
    };

    // Contradictions
    contradictions: {
      [id: string]: {
        claim_a_id: string;
        claim_b_id: string;
        detected_at: number;
        contradiction_type: 'direct' | 'temporal' | 'implication';
        resolved: boolean;
        resolution_type: string | null;
        resolution_notes: string | null;
        resolved_at: number | null;
      }
    };

    // Extension registry
    extensions: {
      [id: string]: {
        extension_type: 'view_synthesizer' | 'extractor' | 'observer';
        name: string;
        description: string;
        config_json: string;
        system_prompt: string;
        user_prompt_template: string; // Contains {VARIABLE} placeholders
        variables_schema_json: string;
        status: 'draft' | 'verified' | 'production';
        version: number;
        created_at: number;
        verified_at: number | null;
      }
    };

    // Synthesis cache
    synthesis_cache: {
      [id: string]: {
        synthesis_type: string;
        cache_key: string;
        content_json: string;
        source_claims_json: string;
        generated_at: number;
        stale: boolean;
        ttl_seconds: number;
      }
    };

    // Sessions
    sessions: {
      [id: string]: {
        started_at: number;
        ended_at: number | null;
        unit_count: number;
        summary: string | null;
        mood_trajectory_json: string | null;
      }
    };

    // Values and Principles (core identity)
    values: {
      [id: string]: {
        statement: string;
        domain: string; // work, relationships, health, etc.
        importance: number; // 0-1
        source_claim_id: string;
        first_expressed: number;
        last_confirmed: number;
        confirmation_count: number;
      }
    };

    // Recurring patterns
    patterns: {
      [id: string]: {
        pattern_type: string;
        description: string;
        evidence_claims_json: string;
        first_detected: number;
        last_detected: number;
        occurrence_count: number;
        confidence: number;
      }
    };
  };

  // TinyBase indexes for fast lookups
  indexes: {
    claims_by_state: { state: string };
    claims_by_chain: { thought_chain_id: string };
    claims_by_subject: { subject: string };
    units_by_session: { session_id: string };
    tasks_by_status: { status: string };
    goals_by_status: { status: string };
    goals_by_parent: { parent_goal_id: string };
  };
}
```

### TinyBase Relationships

```typescript
// Define relationships for easy traversal
const relationships = createRelationships(store);

relationships.setRelationshipDefinition(
  'claimToChain',
  'claims',
  'thought_chains',
  'thought_chain_id'
);

relationships.setRelationshipDefinition(
  'goalToParent',
  'goals',
  'goals',
  'parent_goal_id'
);

relationships.setRelationshipDefinition(
  'claimSources',
  'claim_sources',
  'conversation_units',
  'unit_id'
);
```

---

## Layer 2: Extensible Kernel Architecture

### Core Kernel

The kernel is minimal and handles only:

1. **Data persistence** (TinyBase ↔ IndexedDB)
2. **Task queue management** (durable execution)
3. **Extension loading and execution**
4. **Token budget management**
5. **LLM interface**

```typescript
// kernel.ts - The minimal core

interface Kernel {
  // Store
  store: TinyBaseStore;
  
  // Extension registry
  extensions: ExtensionRegistry;
  
  // Queue
  queue: DurableQueue;
  
  // LLM
  llm: LLMInterface;
  
  // Core operations
  ingest(text: string, source: 'speech' | 'text'): Promise<string>; // Returns unit ID
  process(unitId: string): Promise<void>; // Run extraction pipeline
  query(question: string): Promise<QueryResult>;
  
  // Extension management
  registerExtension(ext: Extension): void;
  executeExtension(id: string, context: ExtensionContext): Promise<any>;
}

interface Extension {
  id: string;
  type: 'extractor' | 'view_synthesizer' | 'observer';
  name: string;
  
  // Status
  status: 'draft' | 'verified' | 'production';
  
  // For extractors
  patterns?: Pattern[];
  relevanceScorer?: (match: Match, context: Context) => number;
  
  // For all types
  systemPrompt: string;
  userPromptTemplate: string; // Contains {VARIABLE} placeholders
  variablesSchema: JSONSchema;
  outputSchema: JSONSchema;
  
  // Hooks
  beforeExecute?: (context: ExtensionContext) => Promise<ExtensionContext>;
  afterExecute?: (result: any, context: ExtensionContext) => Promise<any>;
}
```

### Extension Format (Stored in DB)

```typescript
interface StoredExtension {
  id: string;
  extension_type: 'view_synthesizer' | 'extractor' | 'observer';
  name: string;
  description: string;
  
  config_json: string; // Parsed to:
  // {
  //   priority: number,
  //   tokenBudget: number,
  //   patterns: Pattern[],
  //   relevanceScorerCode: string, // Safe eval or predefined scorers
  // }
  
  system_prompt: string;
  // Example: "You are analyzing a person's beliefs about their career..."
  
  user_prompt_template: string;
  // Example: "Given the following statements about {TOPIC}:\n\n{STATEMENTS}\n\nExtract..."
  
  variables_schema_json: string;
  // {
  //   "TOPIC": { "type": "string", "source": "input" },
  //   "STATEMENTS": { "type": "array", "source": "program_output" }
  // }
  
  output_schema_json: string;
  // JSON Schema for the expected output
  
  status: 'draft' | 'verified' | 'production';
  version: number;
  created_at: number;
  verified_at: number | null;
}
```

### Extension Examples

**View Synthesizer Extension: "Weekly Reflection"**

```json
{
  "id": "view_weekly_reflection",
  "extension_type": "view_synthesizer",
  "name": "Weekly Reflection",
  "description": "Generates a reflection summary of the past week",
  
  "config_json": {
    "priority": 5,
    "tokenBudget": 4000,
    "triggerCondition": "manual_or_scheduled",
    "schedulePattern": "weekly"
  },
  
  "system_prompt": "You are helping someone reflect on their week. Be warm, insightful, and constructive. Focus on growth, patterns, and gentle observations.",
  
  "user_prompt_template": "Here are the key thoughts and events from the past week:\n\n{WEEKLY_CLAIMS}\n\nGoals that were active:\n{ACTIVE_GOALS}\n\nEmotional moments:\n{EMOTIONAL_MARKERS}\n\nPlease provide:\n1. A brief narrative summary of the week\n2. Key themes that emerged\n3. Progress made on goals\n4. One gentle observation or insight\n5. A question for reflection",
  
  "variables_schema_json": {
    "WEEKLY_CLAIMS": {
      "type": "array",
      "source": "query",
      "query": {
        "table": "claims",
        "filter": { "created_at": { "$gte": "{WEEK_START}" } },
        "orderBy": "created_at",
        "limit": 50
      }
    },
    "ACTIVE_GOALS": {
      "type": "array", 
      "source": "query",
      "query": {
        "table": "goals",
        "filter": { "status": "active" }
      }
    },
    "EMOTIONAL_MARKERS": {
      "type": "array",
      "source": "query", 
      "query": {
        "table": "claims",
        "filter": { 
          "created_at": { "$gte": "{WEEK_START}" },
          "emotional_intensity": { "$gte": 0.5 }
        }
      }
    }
  },
  
  "output_schema_json": {
    "type": "object",
    "properties": {
      "narrative": { "type": "string" },
      "themes": { "type": "array", "items": { "type": "string" } },
      "goal_progress": { "type": "array" },
      "insight": { "type": "string" },
      "reflection_question": { "type": "string" }
    }
  },
  
  "status": "production",
  "version": 1
}
```

**Custom Extractor Extension: "Book/Media References"**

```json
{
  "id": "extractor_media_references",
  "extension_type": "extractor",
  "name": "Media Reference Extractor",
  "description": "Extracts references to books, movies, podcasts, articles",
  
  "config_json": {
    "priority": 15,
    "tokenBudget": 1000,
    "patterns": [
      { "type": "keyword", "values": ["reading", "read", "book", "author"] },
      { "type": "keyword", "values": ["watching", "watched", "movie", "show", "series"] },
      { "type": "keyword", "values": ["listening", "podcast", "episode"] },
      { "type": "keyword", "values": ["article", "post", "blog", "tweet"] },
      { "type": "regex", "value": "\"[^\"]+\"" },
      { "type": "regex", "value": "'[^']+'"}
    ],
    "relevanceScorer": "media_reference_scorer"
  },
  
  "system_prompt": "You extract references to media (books, movies, shows, podcasts, articles) from conversational text. Be precise about titles and include context about why the person mentioned it.",
  
  "user_prompt_template": "Text to analyze:\n\n{TEXT}\n\nExtract any references to books, movies, TV shows, podcasts, articles, or other media. For each reference include the title, type, and why it was mentioned.",
  
  "variables_schema_json": {
    "TEXT": { "type": "string", "source": "program_output" }
  },
  
  "output_schema_json": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "media_type": { "type": "string", "enum": ["book", "movie", "tv_show", "podcast", "article", "other"] },
        "creator": { "type": "string" },
        "context": { "type": "string" },
        "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral", "wanting_to_consume"] }
      }
    }
  },
  
  "status": "verified",
  "version": 1
}
```

### Verification Workflow

```typescript
// Extension verification workflow

interface VerificationResult {
  passed: boolean;
  testCases: TestCaseResult[];
  notes: string;
}

async function verifyExtension(ext: StoredExtension): Promise<VerificationResult> {
  // 1. Schema validation
  validateSchema(ext.variables_schema_json);
  validateSchema(ext.output_schema_json);
  
  // 2. Template validation (all variables present)
  validateTemplate(ext.user_prompt_template, ext.variables_schema_json);
  
  // 3. Run on test cases
  const testCases = getTestCasesForType(ext.extension_type);
  const results = await Promise.all(
    testCases.map(tc => runExtensionOnTestCase(ext, tc))
  );
  
  // 4. Output validation
  const allValid = results.every(r => validateOutput(r, ext.output_schema_json));
  
  return {
    passed: allValid,
    testCases: results,
    notes: generateVerificationNotes(results)
  };
}

// Only admin can promote to production
async function promoteToProduction(extId: string, adminKey: string): Promise<void> {
  if (!verifyAdminKey(adminKey)) throw new Error('Unauthorized');
  
  const ext = await store.getRow('extensions', extId);
  if (ext.status !== 'verified') throw new Error('Must be verified first');
  
  await store.setRow('extensions', extId, {
    ...ext,
    status: 'production',
    verified_at: Date.now()
  });
}
```

---

## Layer 3: Extraction Pipeline (Revised)

### Pipeline Overview

```typescript
interface ExtractionPipeline {
  // Main entry point
  process(unitId: string): Promise<ExtractionResult>;
}

interface ExtractionResult {
  unitId: string;
  claims: ExtractedClaim[];
  entities: ExtractedEntity[];
  chainUpdates: ChainUpdate[];
  taskQueue: QueuedTask[];
}
```

### Program Structure (Enhanced)

```typescript
interface ExtractionProgram {
  id: string;
  name: string;
  type: ProgramType;
  version: number;
  priority: number; // Lower = runs first, higher priority in token budget
  
  // Pattern matching
  patterns: Pattern[];
  
  // Relevance scoring (determines order for LLM context)
  relevanceScorer: RelevanceScorer;
  
  // LLM interaction
  extractionPrompt: string;
  outputSchema: JSONSchema;
  
  // Token budget for this program's LLM call
  tokenBudget: number;
  
  // Metadata
  active: boolean;
  isCore: boolean;
  successRate: number;
  runCount: number;
}

type ProgramType = 
  | 'entity'
  | 'claim_factual'
  | 'claim_belief' 
  | 'claim_intention'
  | 'causal'
  | 'question'
  | 'decision'
  | 'emotion'
  | 'temporal'
  | 'goal'
  | 'value'
  | 'relationship'
  | 'self_perception'
  | 'hypothetical'
  | 'preference'
  | 'habit'
  | 'memory_reference'
  | 'media_reference'
  | 'commitment'
  | 'concern'
  | 'learning'
  | 'change_marker';

interface Pattern {
  type: 'regex' | 'keyword' | 'fuzzy' | 'structural' | 'negation' | 'sequence';
  value: string | string[];
  weight: number; // Contribution to relevance score
  context_window?: number; // Characters around match to include
}

interface RelevanceScorer {
  type: 'weighted_sum' | 'custom';
  weights?: Record<string, number>;
  customFunction?: string; // For extension-defined scorers
}

interface Match {
  programId: string;
  text: string;
  position: { start: number; end: number };
  context: string;
  patterns_matched: string[];
  relevance_score: number;
}
```

### Token Budget Manager

```typescript
interface TokenBudgetManager {
  totalBudget: number; // e.g., 8000 tokens
  
  allocate(matches: Match[]): AllocatedMatch[];
}

interface AllocatedMatch extends Match {
  allocated_tokens: number;
  included: boolean;
  truncated: boolean;
}

function allocateTokenBudget(
  matches: Match[], 
  totalBudget: number,
  priorityMap: Map<string, number> // programId -> priority
): AllocatedMatch[] {
  // Sort by: priority (program) * relevance_score
  const sorted = matches.sort((a, b) => {
    const scoreA = priorityMap.get(a.programId)! * a.relevance_score;
    const scoreB = priorityMap.get(b.programId)! * b.relevance_score;
    return scoreB - scoreA; // Descending
  });
  
  let usedTokens = 0;
  const allocated: AllocatedMatch[] = [];
  
  for (const match of sorted) {
    const estimatedTokens = estimateTokens(match.context);
    
    if (usedTokens + estimatedTokens <= totalBudget) {
      allocated.push({
        ...match,
        allocated_tokens: estimatedTokens,
        included: true,
        truncated: false
      });
      usedTokens += estimatedTokens;
    } else if (usedTokens < totalBudget) {
      // Partial allocation - truncate
      const remainingTokens = totalBudget - usedTokens;
      const truncatedContext = truncateToTokens(match.context, remainingTokens);
      allocated.push({
        ...match,
        context: truncatedContext,
        allocated_tokens: remainingTokens,
        included: true,
        truncated: true
      });
      usedTokens = totalBudget;
    } else {
      allocated.push({
        ...match,
        allocated_tokens: 0,
        included: false,
        truncated: false
      });
    }
  }
  
  return allocated;
}
```

### LLM Extractor Interface

```typescript
interface LLMExtractor {
  extract(
    program: ExtractionProgram,
    matches: AllocatedMatch[],
    conversationContext: ConversationContext
  ): Promise<ExtractionOutput>;
}

interface ConversationContext {
  session_id: string;
  timestamp: number;
  preceding_summary: string;
  active_chains: ThoughtChain[];
  active_goals: Goal[];
  recent_entities: Entity[];
}

interface ExtractionOutput {
  success: boolean;
  outputs: any[]; // Matches program.outputSchema
  confidence: number;
  reasoning?: string;
}

// Example LLM call for claim extraction
async function extractClaims(
  matches: AllocatedMatch[],
  context: ConversationContext
): Promise<ExtractionOutput> {
  const systemPrompt = `You are extracting claims from conversational text. 
A claim is any statement that expresses a belief, fact, intention, or assessment.

Output JSON array of claims with this structure:
{
  "statement": "The claim in clear, standalone form",
  "subject": "What/who this is about",
  "claim_type": "factual|belief|intention|assessment|preference",
  "confidence_expressed": 0-1,
  "temporality": "eternal|slowly_decaying|fast_decaying|point_in_time",
  "emotional_valence": -1 to 1,
  "emotional_intensity": 0-1,
  "stakes": "low|medium|high|existential",
  "related_entities": ["entity names"]
}`;

  const userPrompt = `Current conversation context:
- Session: ${context.session_id}
- Active topics: ${context.active_chains.map(c => c.topic).join(', ')}
- Recent context: ${context.preceding_summary}

Text segments to analyze:
${matches.filter(m => m.included).map((m, i) => `[${i + 1}] ${m.context}`).join('\n\n')}

Extract all claims from these segments. Be thorough but precise.`;

  const response = await llm.complete({
    systemPrompt,
    userPrompt,
    responseFormat: 'json',
    maxTokens: 2000
  });
  
  return {
    success: true,
    outputs: JSON.parse(response),
    confidence: 0.9
  };
}
```

---

## Layer 4: Core Extraction Programs (Comprehensive)

### Entity Extraction

```typescript
const entityExtractor: ExtractionProgram = {
  id: 'core_entity',
  name: 'Entity Extraction',
  type: 'entity',
  version: 1,
  priority: 1, // Runs first, high priority
  
  patterns: [
    // Proper nouns (capitalized words/phrases)
    { type: 'regex', value: '\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+\\b', weight: 0.8 },
    
    // After named phrases
    { type: 'sequence', value: ['called', 'named', 'known as'], weight: 0.9 },
    { type: 'sequence', value: ['at', 'with', 'from', 'by'], weight: 0.5 },
    
    // Titles
    { type: 'regex', value: '\\b(?:Mr|Mrs|Ms|Dr|Prof)\\.?\\s+[A-Z][a-z]+', weight: 0.9 },
    
    // Organizations
    { type: 'keyword', values: ['Inc', 'Corp', 'LLC', 'Ltd', 'Company', 'Team', 'Group'], weight: 0.8 },
    
    // Products/Projects
    { type: 'regex', value: '\\b[A-Z][a-zA-Z0-9]+(?:\\s+[A-Z][a-zA-Z0-9]+)*\\b', weight: 0.4 },
    
    // Quoted names
    { type: 'regex', value: '"[^"]+"|\'[^\']+\'', weight: 0.7 },
    
    // Roles
    { type: 'keyword', values: ['CEO', 'CTO', 'manager', 'director', 'lead', 'founder'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract named entities from the text. For each entity:
- canonical_name: The standard/full name
- entity_type: person|organization|product|place|project|role|event|concept
- aliases: Other names/abbreviations mentioned
- context: Brief description of entity from context
- relationship_to_speaker: How does the speaker relate to this entity?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        canonical_name: { type: 'string' },
        entity_type: { type: 'string', enum: ['person', 'organization', 'product', 'place', 'project', 'role', 'event', 'concept'] },
        aliases: { type: 'array', items: { type: 'string' } },
        context: { type: 'string' },
        relationship_to_speaker: { type: 'string' }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Factual Claim Extraction

```typescript
const factualClaimExtractor: ExtractionProgram = {
  id: 'core_claim_factual',
  name: 'Factual Claim Extraction',
  type: 'claim_factual',
  version: 1,
  priority: 2,
  
  patterns: [
    // Declarative statements
    { type: 'structural', value: 'subject_verb_object', weight: 0.6 },
    
    // State verbs
    { type: 'keyword', values: ['is', 'are', 'was', 'were', 'has', 'have', 'had'], weight: 0.5 },
    
    // Factual markers
    { type: 'keyword', values: ['actually', 'in fact', 'really', 'definitely', 'certainly'], weight: 0.8 },
    
    // Numbers and specifics
    { type: 'regex', value: '\\b\\d+(?:\\.\\d+)?(?:\\s*%|\\s*percent)?\\b', weight: 0.7 },
    { type: 'regex', value: '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?', weight: 0.7 },
    
    // Time specifics
    { type: 'regex', value: '\\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b', weight: 0.6 },
    
    // Existence claims
    { type: 'keyword', values: ['there is', 'there are', 'exists', 'exist'], weight: 0.6 },
    
    // Negations
    { type: 'negation', value: ['not', 'never', 'no', "doesn't", "don't", "isn't", "aren't"], weight: 0.5 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract factual claims - statements about how things are or were.
For each claim:
- statement: The claim in clear, standalone form
- subject: What this is about  
- claim_type: "factual"
- confidence_expressed: How certain is the speaker? (0-1)
- verifiability: Can this be verified? "easily"|"with_effort"|"subjective"|"not_verifiable"
- temporality: When is this true? "eternal"|"slowly_decaying"|"fast_decaying"|"point_in_time"
- specificity: "precise"|"approximate"|"vague"`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        subject: { type: 'string' },
        claim_type: { type: 'string', const: 'factual' },
        confidence_expressed: { type: 'number', minimum: 0, maximum: 1 },
        verifiability: { type: 'string', enum: ['easily', 'with_effort', 'subjective', 'not_verifiable'] },
        temporality: { type: 'string', enum: ['eternal', 'slowly_decaying', 'fast_decaying', 'point_in_time'] },
        specificity: { type: 'string', enum: ['precise', 'approximate', 'vague'] }
      }
    }
  },
  
  tokenBudget: 2000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Belief Extraction

```typescript
const beliefExtractor: ExtractionProgram = {
  id: 'core_claim_belief',
  name: 'Belief Extraction',
  type: 'claim_belief',
  version: 1,
  priority: 3,
  
  patterns: [
    // Belief markers
    { type: 'keyword', values: ['I think', 'I believe', 'I feel', 'in my opinion', 'to me'], weight: 0.9 },
    { type: 'keyword', values: ['seems', 'appears', 'looks like', 'sounds like'], weight: 0.7 },
    
    // Modal beliefs
    { type: 'keyword', values: ['probably', 'likely', 'possibly', 'maybe', 'perhaps'], weight: 0.7 },
    { type: 'keyword', values: ['must be', 'should be', 'would be', 'could be', 'might be'], weight: 0.6 },
    
    // Evaluative
    { type: 'keyword', values: ['good', 'bad', 'better', 'worse', 'best', 'worst'], weight: 0.5 },
    { type: 'keyword', values: ['important', 'crucial', 'critical', 'essential', 'key'], weight: 0.6 },
    { type: 'keyword', values: ['right', 'wrong', 'fair', 'unfair'], weight: 0.7 },
    
    // Generalizations
    { type: 'keyword', values: ['always', 'never', 'usually', 'typically', 'generally', 'often'], weight: 0.5 },
    
    // World models
    { type: 'keyword', values: ['the way', 'how things', 'the truth is', 'reality is'], weight: 0.8 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract beliefs and opinions - subjective views about how things are.
For each belief:
- statement: The belief in clear form
- subject: What this belief is about
- claim_type: "belief"
- belief_strength: How strongly held? "tentative"|"moderate"|"strong"|"core"
- basis: What's this belief based on? "experience"|"reasoning"|"intuition"|"authority"|"emotion"|"unknown"
- openness_to_change: How revisable? "open"|"somewhat"|"resistant"|"fixed"
- domain: What area of life? "work"|"relationships"|"self"|"world"|"values"|"practical"`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        subject: { type: 'string' },
        claim_type: { type: 'string', const: 'belief' },
        belief_strength: { type: 'string', enum: ['tentative', 'moderate', 'strong', 'core'] },
        basis: { type: 'string', enum: ['experience', 'reasoning', 'intuition', 'authority', 'emotion', 'unknown'] },
        openness_to_change: { type: 'string', enum: ['open', 'somewhat', 'resistant', 'fixed'] },
        domain: { type: 'string' }
      }
    }
  },
  
  tokenBudget: 2000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Intention Extraction

```typescript
const intentionExtractor: ExtractionProgram = {
  id: 'core_claim_intention',
  name: 'Intention Extraction',
  type: 'claim_intention',
  version: 1,
  priority: 4,
  
  patterns: [
    // Direct intentions
    { type: 'keyword', values: ['I will', "I'll", 'I am going to', 'I plan to', 'I intend to'], weight: 0.9 },
    { type: 'keyword', values: ['going to', 'gonna', 'about to', 'planning to'], weight: 0.8 },
    
    // Wants and desires
    { type: 'keyword', values: ['I want', 'I wish', 'I hope', "I'd like", 'I need to'], weight: 0.7 },
    
    // Commitments
    { type: 'keyword', values: ['I promise', 'I commit', 'I swear', "I'm committed"], weight: 0.9 },
    { type: 'keyword', values: ['have to', 'must', 'need to', 'got to'], weight: 0.6 },
    
    // Future orientation
    { type: 'keyword', values: ['tomorrow', 'next week', 'next month', 'soon', 'eventually'], weight: 0.5 },
    { type: 'keyword', values: ['by the end of', 'within', 'before'], weight: 0.5 },
    
    // Negated intentions
    { type: 'keyword', values: ["won't", "I'm not going to", 'refuse to', "don't want to"], weight: 0.7 },
    
    // Conditional intentions
    { type: 'sequence', value: ['if', 'then I will'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract intentions and plans - what the person intends to do.
For each intention:
- statement: The intention clearly stated
- action: What action will be taken
- claim_type: "intention"
- commitment_level: How committed? "considering"|"intending"|"committed"|"promised"
- timeframe: When? "immediate"|"soon"|"near_future"|"far_future"|"unspecified"
- contingency: Is this conditional on something? null or the condition
- motivation: Why do they want this? (if mentioned)
- obstacles_mentioned: Any obstacles mentioned?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        action: { type: 'string' },
        claim_type: { type: 'string', const: 'intention' },
        commitment_level: { type: 'string', enum: ['considering', 'intending', 'committed', 'promised'] },
        timeframe: { type: 'string', enum: ['immediate', 'soon', 'near_future', 'far_future', 'unspecified'] },
        contingency: { type: ['string', 'null'] },
        motivation: { type: ['string', 'null'] },
        obstacles_mentioned: { type: ['array', 'null'], items: { type: 'string' } }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Causal Belief Extraction

```typescript
const causalExtractor: ExtractionProgram = {
  id: 'core_causal',
  name: 'Causal Belief Extraction',
  type: 'causal',
  version: 1,
  priority: 5,
  
  patterns: [
    // Explicit causation
    { type: 'keyword', values: ['because', 'since', 'as a result', 'therefore', 'thus', 'hence'], weight: 0.9 },
    { type: 'keyword', values: ['caused', 'causes', 'led to', 'leads to', 'resulted in', 'results in'], weight: 0.9 },
    { type: 'keyword', values: ['due to', 'owing to', 'thanks to', 'on account of'], weight: 0.8 },
    
    // Conditional causation
    { type: 'sequence', value: ['if', 'then'], weight: 0.8 },
    { type: 'sequence', value: ['when', 'then'], weight: 0.7 },
    { type: 'keyword', values: ['whenever', 'every time'], weight: 0.7 },
    
    // Mechanisms
    { type: 'keyword', values: ['by', 'through', 'via', 'using'], weight: 0.4 },
    { type: 'keyword', values: ['in order to', 'so that', 'to achieve'], weight: 0.6 },
    
    // Preventive
    { type: 'keyword', values: ['prevents', 'stops', 'blocks', 'avoids', 'protects'], weight: 0.7 },
    
    // Enabling
    { type: 'keyword', values: ['enables', 'allows', 'makes possible', 'helps'], weight: 0.6 },
    
    // Why questions (implicit causal model)
    { type: 'regex', value: '\\bwhy\\b.*\\?', weight: 0.5 },
    
    // Reason-giving
    { type: 'keyword', values: ['the reason', 'the cause', 'what makes', 'what causes'], weight: 0.8 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract causal beliefs - beliefs about what causes what.
For each causal relationship:
- statement: The causal belief stated
- cause: What is the cause
- effect: What is the effect
- relationship_type: "causes"|"prevents"|"enables"|"correlates"|"contributes_to"
- confidence: How certain is the speaker about this causation? 0-1
- directionality: "unidirectional"|"bidirectional"
- mechanism: How does the cause create the effect? (if mentioned)
- domain: What domain is this about?
- is_personal: Is this about their personal experience or general world?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        cause: { type: 'string' },
        effect: { type: 'string' },
        relationship_type: { type: 'string', enum: ['causes', 'prevents', 'enables', 'correlates', 'contributes_to'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        directionality: { type: 'string', enum: ['unidirectional', 'bidirectional'] },
        mechanism: { type: ['string', 'null'] },
        domain: { type: 'string' },
        is_personal: { type: 'boolean' }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Question/Uncertainty Extraction

```typescript
const uncertaintyExtractor: ExtractionProgram = {
  id: 'core_uncertainty',
  name: 'Question & Uncertainty Extraction',
  type: 'question',
  version: 1,
  priority: 6,
  
  patterns: [
    // Direct questions
    { type: 'regex', value: '.*\\?$', weight: 0.9 },
    { type: 'keyword', values: ['who', 'what', 'where', 'when', 'why', 'how', 'which'], weight: 0.5 },
    
    // Uncertainty markers
    { type: 'keyword', values: ["I don't know", "I'm not sure", 'uncertain', "I wonder"], weight: 0.9 },
    { type: 'keyword', values: ['maybe', 'perhaps', 'possibly', 'might', 'could be'], weight: 0.6 },
    { type: 'keyword', values: ['unclear', 'confusing', 'puzzling', "don't understand"], weight: 0.8 },
    
    // Seeking input
    { type: 'keyword', values: ['should I', 'what if', 'would it be', 'is it better'], weight: 0.7 },
    { type: 'keyword', values: ['any ideas', 'any thoughts', 'suggestions', 'advice'], weight: 0.7 },
    
    // Open considerations
    { type: 'keyword', values: ['considering', 'thinking about', 'weighing', 'debating'], weight: 0.6 },
    { type: 'keyword', values: ['on one hand', 'on the other hand', 'alternatively'], weight: 0.7 },
    
    // Knowledge gaps
    { type: 'keyword', values: ['need to find out', 'need to learn', 'need to figure out'], weight: 0.8 },
    { type: 'keyword', values: ["haven't decided", "haven't figured out", "can't tell"], weight: 0.7 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract questions, uncertainties, and knowledge gaps.
For each uncertainty:
- statement: The question or uncertainty
- uncertainty_type: "factual_question"|"decision_question"|"existential_question"|"knowledge_gap"|"ambivalence"
- subject: What is the uncertainty about
- importance: How important is resolving this? "low"|"medium"|"high"|"critical"
- blockers: What's preventing resolution?
- options_considered: If a decision, what options are being weighed?
- time_sensitivity: Is there urgency? "none"|"low"|"moderate"|"urgent"`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        uncertainty_type: { type: 'string', enum: ['factual_question', 'decision_question', 'existential_question', 'knowledge_gap', 'ambivalence'] },
        subject: { type: 'string' },
        importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        blockers: { type: ['array', 'null'], items: { type: 'string' } },
        options_considered: { type: ['array', 'null'], items: { type: 'string' } },
        time_sensitivity: { type: 'string', enum: ['none', 'low', 'moderate', 'urgent'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Decision Extraction

```typescript
const decisionExtractor: ExtractionProgram = {
  id: 'core_decision',
  name: 'Decision Extraction',
  type: 'decision',
  version: 1,
  priority: 7,
  
  patterns: [
    // Made decisions
    { type: 'keyword', values: ['I decided', "I've decided", 'decision is', 'my decision'], weight: 0.95 },
    { type: 'keyword', values: ['chose', 'picked', 'selected', 'went with', 'opted for'], weight: 0.85 },
    
    // Final language
    { type: 'keyword', values: ["that's final", 'made up my mind', 'settled on', 'going with'], weight: 0.9 },
    
    // Comparative choices
    { type: 'keyword', values: ['instead of', 'rather than', 'over', 'versus'], weight: 0.7 },
    { type: 'keyword', values: ['better than', 'prefer', 'best option'], weight: 0.6 },
    
    // Resolution language
    { type: 'keyword', values: ['figured out', 'resolved', 'concluded', 'determined'], weight: 0.7 },
    
    // Rejection
    { type: 'keyword', values: ['not going to', "won't", 'rejected', 'ruled out', 'dismissed'], weight: 0.7 },
    
    // Commitment indicators
    { type: 'keyword', values: ['going forward', 'from now on', "that's the plan"], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract decisions - choices that have been made or are being made.
For each decision:
- statement: The decision stated
- decision: What was decided
- alternatives_rejected: What alternatives were not chosen
- reasoning: Why was this chosen? (if mentioned)
- confidence_level: How confident in the decision? "tentative"|"moderate"|"confident"|"certain"
- reversibility: "easily_reversible"|"reversible_with_cost"|"hard_to_reverse"|"irreversible"
- domain: What area of life?
- stakes: "low"|"medium"|"high"|"critical"
- timeline: When was/will this be enacted?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        decision: { type: 'string' },
        alternatives_rejected: { type: ['array', 'null'], items: { type: 'string' } },
        reasoning: { type: ['string', 'null'] },
        confidence_level: { type: 'string', enum: ['tentative', 'moderate', 'confident', 'certain'] },
        reversibility: { type: 'string', enum: ['easily_reversible', 'reversible_with_cost', 'hard_to_reverse', 'irreversible'] },
        domain: { type: 'string' },
        stakes: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        timeline: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Emotional State Extraction

```typescript
const emotionExtractor: ExtractionProgram = {
  id: 'core_emotion',
  name: 'Emotional State Extraction',
  type: 'emotion',
  version: 1,
  priority: 8,
  
  patterns: [
    // Primary emotions
    { type: 'keyword', values: ['happy', 'sad', 'angry', 'afraid', 'surprised', 'disgusted'], weight: 0.9 },
    
    // Complex emotions
    { type: 'keyword', values: ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'], weight: 0.9 },
    { type: 'keyword', values: ['excited', 'hopeful', 'optimistic', 'enthusiastic', 'eager'], weight: 0.9 },
    { type: 'keyword', values: ['frustrated', 'annoyed', 'irritated', 'upset', 'furious'], weight: 0.9 },
    { type: 'keyword', values: ['grateful', 'thankful', 'appreciative', 'blessed'], weight: 0.9 },
    { type: 'keyword', values: ['lonely', 'isolated', 'disconnected', 'abandoned'], weight: 0.9 },
    { type: 'keyword', values: ['confident', 'proud', 'accomplished', 'satisfied'], weight: 0.9 },
    { type: 'keyword', values: ['ashamed', 'embarrassed', 'guilty', 'regretful'], weight: 0.9 },
    { type: 'keyword', values: ['confused', 'lost', 'uncertain', 'torn'], weight: 0.8 },
    { type: 'keyword', values: ['bored', 'restless', 'unfulfilled', 'stuck'], weight: 0.8 },
    
    // Feeling statements
    { type: 'keyword', values: ['I feel', 'I am feeling', 'feeling', 'I felt'], weight: 0.85 },
    { type: 'keyword', values: ['makes me feel', 'made me feel', 'I get'], weight: 0.8 },
    
    // Intensifiers
    { type: 'keyword', values: ['so', 'very', 'really', 'extremely', 'incredibly'], weight: 0.3 },
    
    // Physical manifestations
    { type: 'keyword', values: ["can't sleep", "couldn't eat", 'heart racing', 'butterflies'], weight: 0.7 },
    
    // Emotional actions
    { type: 'keyword', values: ['cried', 'laughed', 'screamed', 'smiled', 'sighed'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract emotional states and feelings.
For each emotional expression:
- statement: What was said
- primary_emotion: Main emotion category
- nuanced_emotion: More specific emotion
- valence: -1 (negative) to 1 (positive)
- intensity: 0 (mild) to 1 (extreme)
- trigger: What caused this emotion? (if mentioned)
- subject: Is this about self, others, or situation?
- temporality: "momentary"|"recent"|"ongoing"|"chronic"
- physical_manifestations: Any physical symptoms mentioned?
- coping_mentioned: Any coping strategies mentioned?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        primary_emotion: { type: 'string', enum: ['joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'trust', 'anticipation'] },
        nuanced_emotion: { type: 'string' },
        valence: { type: 'number', minimum: -1, maximum: 1 },
        intensity: { type: 'number', minimum: 0, maximum: 1 },
        trigger: { type: ['string', 'null'] },
        subject: { type: 'string', enum: ['self', 'other_person', 'situation', 'abstract'] },
        temporality: { type: 'string', enum: ['momentary', 'recent', 'ongoing', 'chronic'] },
        physical_manifestations: { type: ['array', 'null'], items: { type: 'string' } },
        coping_mentioned: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Goal Extraction

```typescript
const goalExtractor: ExtractionProgram = {
  id: 'core_goal',
  name: 'Goal Extraction',
  type: 'goal',
  version: 1,
  priority: 9,
  
  patterns: [
    // Explicit goals
    { type: 'keyword', values: ['my goal is', 'goal is to', 'I aim to', 'I aspire to'], weight: 0.95 },
    { type: 'keyword', values: ['objective is', 'target is', 'I want to achieve'], weight: 0.9 },
    
    // Desires
    { type: 'keyword', values: ['I want', 'I wish', 'I hope', "I'd love to", 'dream of'], weight: 0.7 },
    { type: 'keyword', values: ['looking forward to', 'can\'t wait to', 'excited to'], weight: 0.6 },
    
    // Needs
    { type: 'keyword', values: ['I need to', 'have to', 'must', 'require'], weight: 0.6 },
    
    // Striving
    { type: 'keyword', values: ['working towards', 'striving for', 'pursuing', 'chasing'], weight: 0.85 },
    { type: 'keyword', values: ['trying to', 'attempting to', 'working on'], weight: 0.7 },
    
    // Outcomes
    { type: 'keyword', values: ['so that', 'in order to', 'to be able to', 'to become'], weight: 0.6 },
    
    // Identity goals
    { type: 'keyword', values: ['I want to be', "I'd like to become", 'kind of person who'], weight: 0.85 },
    
    // Avoidance goals
    { type: 'keyword', values: ["don't want to", 'avoid', 'prevent', 'stop being'], weight: 0.7 },
    
    // Success/failure framing
    { type: 'keyword', values: ['succeed at', 'accomplish', 'complete', 'finish'], weight: 0.6 },
    { type: 'keyword', values: ['fail at', "haven't achieved", 'struggling with'], weight: 0.5 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract goals - what the person wants to achieve or become.
For each goal:
- statement: The goal stated
- goal_statement: Clear, actionable goal statement
- goal_type: "outcome"|"process"|"identity"|"avoidance"|"maintenance"
- domain: "career"|"health"|"relationships"|"financial"|"learning"|"creative"|"personal_growth"|"other"
- timeframe: "immediate"|"short_term"|"medium_term"|"long_term"|"life"
- specificity: "vague"|"general"|"specific"|"measurable"
- motivation: Why do they want this?
- current_status: "not_started"|"in_progress"|"blocked"|"near_completion"|"achieved"|"abandoned"
- obstacles: What's in the way?
- sub_goals: Any mentioned sub-goals?
- parent_goal: Is this part of a bigger goal?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        goal_statement: { type: 'string' },
        goal_type: { type: 'string', enum: ['outcome', 'process', 'identity', 'avoidance', 'maintenance'] },
        domain: { type: 'string' },
        timeframe: { type: 'string', enum: ['immediate', 'short_term', 'medium_term', 'long_term', 'life'] },
        specificity: { type: 'string', enum: ['vague', 'general', 'specific', 'measurable'] },
        motivation: { type: ['string', 'null'] },
        current_status: { type: 'string', enum: ['not_started', 'in_progress', 'blocked', 'near_completion', 'achieved', 'abandoned'] },
        obstacles: { type: ['array', 'null'], items: { type: 'string' } },
        sub_goals: { type: ['array', 'null'], items: { type: 'string' } },
        parent_goal: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Value/Principle Extraction

```typescript
const valueExtractor: ExtractionProgram = {
  id: 'core_value',
  name: 'Value & Principle Extraction',
  type: 'value',
  version: 1,
  priority: 10,
  
  patterns: [
    // Explicit values
    { type: 'keyword', values: ['I value', 'I believe in', 'important to me', 'matters to me'], weight: 0.95 },
    { type: 'keyword', values: ['I care about', 'I prioritize', 'I stand for'], weight: 0.9 },
    
    // Principles
    { type: 'keyword', values: ['my principle', 'I always', 'I never', 'rule is'], weight: 0.85 },
    { type: 'keyword', values: ['should', 'ought to', 'must', 'right thing'], weight: 0.5 },
    
    // Evaluative statements
    { type: 'keyword', values: ['wrong to', 'right to', 'fair', 'unfair', 'just', 'unjust'], weight: 0.7 },
    { type: 'keyword', values: ['ethical', 'moral', 'immoral', 'good', 'bad', 'evil'], weight: 0.7 },
    
    // Identity values
    { type: 'keyword', values: ['who I am', 'defines me', 'core to', 'fundamental'], weight: 0.8 },
    
    // Trade-off language
    { type: 'keyword', values: ['more important than', 'would rather', 'never sacrifice'], weight: 0.8 },
    
    // Disgust/approval
    { type: 'keyword', values: ['hate when', 'love when', "can't stand", 'admire when'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract values and principles - core beliefs about what matters.
For each value:
- statement: What was said
- value_statement: The value/principle clearly stated
- domain: "ethics"|"relationships"|"work"|"lifestyle"|"society"|"self"|"other"
- importance: 0 (minor preference) to 1 (core value)
- is_principle: Is this a guiding rule vs a preference?
- source: Where does this value come from? "personal"|"family"|"culture"|"experience"|"reasoning"
- stability: How stable is this? "evolving"|"stable"|"core"
- trade_offs: What would they sacrifice for this?
- conflicts_with: Does this conflict with other mentioned values?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        value_statement: { type: 'string' },
        domain: { type: 'string' },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        is_principle: { type: 'boolean' },
        source: { type: 'string', enum: ['personal', 'family', 'culture', 'experience', 'reasoning'] },
        stability: { type: 'string', enum: ['evolving', 'stable', 'core'] },
        trade_offs: { type: ['array', 'null'], items: { type: 'string' } },
        conflicts_with: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Relationship Extraction

```typescript
const relationshipExtractor: ExtractionProgram = {
  id: 'core_relationship',
  name: 'Relationship Extraction',
  type: 'relationship',
  version: 1,
  priority: 11,
  
  patterns: [
    // Relationship markers
    { type: 'keyword', values: ['my friend', 'my family', 'my colleague', 'my partner', 'my boss'], weight: 0.9 },
    { type: 'keyword', values: ['my mother', 'my father', 'my sister', 'my brother', 'my spouse'], weight: 0.9 },
    { type: 'keyword', values: ['boyfriend', 'girlfriend', 'husband', 'wife', 'ex-'], weight: 0.9 },
    
    // Relationship descriptions
    { type: 'keyword', values: ['close to', 'distant from', 'connected with', 'estranged from'], weight: 0.8 },
    { type: 'keyword', values: ['trust', "don't trust", 'rely on', 'depend on'], weight: 0.7 },
    
    // Interpersonal dynamics
    { type: 'keyword', values: ['we always', 'we never', 'between us', 'our relationship'], weight: 0.8 },
    { type: 'keyword', values: ['argue', 'fight', 'disagree', 'conflict'], weight: 0.6 },
    { type: 'keyword', values: ['support', 'help each other', 'there for'], weight: 0.6 },
    
    // Social context
    { type: 'keyword', values: ['met at', 'known for', 'years', 'since'], weight: 0.5 },
    
    // Emotional bonds
    { type: 'keyword', values: ['love', 'hate', 'admire', 'respect', 'resent'], weight: 0.7 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract relationship information.
For each relationship mentioned:
- statement: What was said
- person: Who is the other person (name or role)
- relationship_type: "family"|"friend"|"romantic"|"professional"|"acquaintance"|"other"
- specific_role: More specific role (mother, boss, best friend, etc.)
- quality: How is the relationship? "positive"|"negative"|"mixed"|"neutral"|"complicated"
- closeness: 0 (distant) to 1 (very close)
- trust_level: 0 (no trust) to 1 (complete trust)
- dynamics: Any specific patterns or dynamics mentioned
- history: Any history mentioned
- current_status: "active"|"strained"|"growing"|"declining"|"ended"`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        person: { type: 'string' },
        relationship_type: { type: 'string', enum: ['family', 'friend', 'romantic', 'professional', 'acquaintance', 'other'] },
        specific_role: { type: ['string', 'null'] },
        quality: { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral', 'complicated'] },
        closeness: { type: 'number', minimum: 0, maximum: 1 },
        trust_level: { type: 'number', minimum: 0, maximum: 1 },
        dynamics: { type: ['string', 'null'] },
        history: { type: ['string', 'null'] },
        current_status: { type: 'string', enum: ['active', 'strained', 'growing', 'declining', 'ended'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Self-Perception Extraction

```typescript
const selfPerceptionExtractor: ExtractionProgram = {
  id: 'core_self_perception',
  name: 'Self-Perception Extraction',
  type: 'self_perception',
  version: 1,
  priority: 12,
  
  patterns: [
    // Identity statements
    { type: 'keyword', values: ['I am', "I'm", 'I am a', 'I am the type of'], weight: 0.8 },
    { type: 'keyword', values: ['kind of person', 'type of person', 'sort of person'], weight: 0.9 },
    
    // Abilities
    { type: 'keyword', values: ['I can', "I can't", 'I am able to', 'I am good at', 'I am bad at'], weight: 0.8 },
    { type: 'keyword', values: ['my strength', 'my weakness', 'I excel at', 'I struggle with'], weight: 0.9 },
    
    // Self-evaluation
    { type: 'keyword', values: ["I'm not", "I'm too", "I'm very", 'I tend to'], weight: 0.6 },
    { type: 'keyword', values: ['my problem is', 'my issue is', 'my flaw'], weight: 0.8 },
    
    // Comparison
    { type: 'keyword', values: ['unlike others', 'compared to', 'better than', 'worse than'], weight: 0.6 },
    
    // Identity changes
    { type: 'keyword', values: ['I used to be', 'I became', "I'm becoming", 'I was'], weight: 0.7 },
    
    // Roles
    { type: 'keyword', values: ['as a', 'in my role as', 'being a'], weight: 0.5 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract self-perceptions - how the person sees themselves.
For each self-perception:
- statement: What was said
- self_description: The self-description
- dimension: "ability"|"personality"|"identity"|"role"|"limitation"|"aspiration"
- valence: -1 (negative self-view) to 1 (positive)
- confidence: How certain about this self-view? 0-1
- stability: "fixed"|"changeable"|"in_flux"
- comparison_to_others: Any comparison to others?
- source: Where does this self-view come from? "direct_experience"|"feedback"|"comparison"|"introspection"
- affects_behavior: How does this affect behavior?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        self_description: { type: 'string' },
        dimension: { type: 'string', enum: ['ability', 'personality', 'identity', 'role', 'limitation', 'aspiration'] },
        valence: { type: 'number', minimum: -1, maximum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        stability: { type: 'string', enum: ['fixed', 'changeable', 'in_flux'] },
        comparison_to_others: { type: ['string', 'null'] },
        source: { type: 'string', enum: ['direct_experience', 'feedback', 'comparison', 'introspection'] },
        affects_behavior: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Preference Extraction

```typescript
const preferenceExtractor: ExtractionProgram = {
  id: 'core_preference',
  name: 'Preference Extraction',
  type: 'preference',
  version: 1,
  priority: 13,
  
  patterns: [
    // Likes/dislikes
    { type: 'keyword', values: ['I like', 'I love', 'I enjoy', 'I prefer', 'I hate', 'I dislike'], weight: 0.9 },
    { type: 'keyword', values: ['favorite', 'favourite', 'best', 'worst'], weight: 0.8 },
    
    // Preferences
    { type: 'keyword', values: ['I prefer', "I'd rather", 'instead of', 'rather than'], weight: 0.9 },
    { type: 'keyword', values: ['over', 'vs', 'versus', 'compared to'], weight: 0.5 },
    
    // Tastes
    { type: 'keyword', values: ['my taste', 'my style', 'my type'], weight: 0.8 },
    { type: 'keyword', values: ['not my thing', 'my cup of tea', 'my jam'], weight: 0.8 },
    
    // Comfort
    { type: 'keyword', values: ['comfortable with', 'uncomfortable with', 'at ease', 'uneasy'], weight: 0.7 },
    
    // Activities
    { type: 'keyword', values: ['I usually', 'I always', 'I never', 'I tend to'], weight: 0.5 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract preferences - likes, dislikes, and preferred choices.
For each preference:
- statement: What was said
- preference: The preference clearly stated
- preference_type: "like"|"dislike"|"preference_between"|"habit"|"comfort"
- domain: What area? "food"|"entertainment"|"social"|"work"|"lifestyle"|"aesthetic"|"other"
- intensity: 0 (mild) to 1 (strong)
- reasoning: Why this preference? (if mentioned)
- context_dependent: Is this contextual?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        preference: { type: 'string' },
        preference_type: { type: 'string', enum: ['like', 'dislike', 'preference_between', 'habit', 'comfort'] },
        domain: { type: 'string' },
        intensity: { type: 'number', minimum: 0, maximum: 1 },
        reasoning: { type: ['string', 'null'] },
        context_dependent: { type: 'boolean' }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Habit/Routine Extraction

```typescript
const habitExtractor: ExtractionProgram = {
  id: 'core_habit',
  name: 'Habit & Routine Extraction',
  type: 'habit',
  version: 1,
  priority: 14,
  
  patterns: [
    // Frequency
    { type: 'keyword', values: ['every day', 'daily', 'weekly', 'monthly', 'regularly'], weight: 0.9 },
    { type: 'keyword', values: ['always', 'usually', 'often', 'sometimes', 'rarely', 'never'], weight: 0.7 },
    
    // Routines
    { type: 'keyword', values: ['routine', 'habit', 'ritual', 'practice'], weight: 0.95 },
    { type: 'keyword', values: ['every morning', 'every night', 'before bed', 'first thing'], weight: 0.9 },
    
    // Patterns
    { type: 'keyword', values: ['I tend to', 'I usually', 'I typically', 'I normally'], weight: 0.8 },
    { type: 'keyword', values: ['whenever I', 'every time I', 'when I'], weight: 0.6 },
    
    // Building/breaking
    { type: 'keyword', values: ['trying to', 'started', 'stopped', 'quit', 'gave up'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract habits and routines.
For each habit:
- statement: What was said
- habit_description: The habit/routine
- frequency: "daily"|"weekly"|"monthly"|"occasionally"|"contextual"
- context: When/where does this happen?
- status: "active"|"trying_to_build"|"trying_to_break"|"lapsed"|"former"
- duration: How long have they done this?
- motivation: Why do they do this?
- positive_or_negative: Is this seen as good or bad?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        habit_description: { type: 'string' },
        frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'occasionally', 'contextual'] },
        context: { type: ['string', 'null'] },
        status: { type: 'string', enum: ['active', 'trying_to_build', 'trying_to_break', 'lapsed', 'former'] },
        duration: { type: ['string', 'null'] },
        motivation: { type: ['string', 'null'] },
        positive_or_negative: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Memory Reference Extraction

```typescript
const memoryReferenceExtractor: ExtractionProgram = {
  id: 'core_memory_reference',
  name: 'Memory Reference Extraction',
  type: 'memory_reference',
  version: 1,
  priority: 15,
  
  patterns: [
    // Explicit remembering
    { type: 'keyword', values: ['I remember', 'I recall', 'I reminisce', 'reminds me'], weight: 0.95 },
    { type: 'keyword', values: ['back when', 'that time when', 'once', 'there was a time'], weight: 0.9 },
    
    // Temporal markers
    { type: 'keyword', values: ['years ago', 'months ago', 'when I was', 'as a child', 'growing up'], weight: 0.8 },
    { type: 'keyword', values: ['in college', 'at my old job', 'before', 'after'], weight: 0.6 },
    
    // Narrative
    { type: 'keyword', values: ['the story of', 'let me tell you about', 'did I ever tell you'], weight: 0.8 },
    
    // Forgetting
    { type: 'keyword', values: ['I forgot', "don't remember", "can't recall", 'fuzzy on'], weight: 0.7 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract references to past memories and experiences.
For each memory reference:
- statement: What was said
- memory_summary: Brief summary of the memory
- time_period: When did this happen?
- vividness: How vivid? "vague"|"moderate"|"vivid"
- emotional_tone: What emotion is associated?
- significance: Why is this memory being recalled?
- people_involved: Who was in this memory?
- recurring: Is this a memory they return to often?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        memory_summary: { type: 'string' },
        time_period: { type: ['string', 'null'] },
        vividness: { type: 'string', enum: ['vague', 'moderate', 'vivid'] },
        emotional_tone: { type: 'string' },
        significance: { type: ['string', 'null'] },
        people_involved: { type: ['array', 'null'], items: { type: 'string' } },
        recurring: { type: 'boolean' }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Concern/Worry Extraction

```typescript
const concernExtractor: ExtractionProgram = {
  id: 'core_concern',
  name: 'Concern & Worry Extraction',
  type: 'concern',
  version: 1,
  priority: 16,
  
  patterns: [
    // Explicit worry
    { type: 'keyword', values: ['I worry', "I'm worried", 'concerned about', 'I fear'], weight: 0.95 },
    { type: 'keyword', values: ['anxious about', 'nervous about', 'stressed about'], weight: 0.9 },
    
    // What-if thinking
    { type: 'keyword', values: ['what if', 'what happens if', 'imagine if'], weight: 0.8 },
    { type: 'keyword', values: ["I hope it doesn't", 'afraid that', 'scared that'], weight: 0.85 },
    
    // Risk awareness
    { type: 'keyword', values: ['risk', 'danger', 'threat', 'problem could be'], weight: 0.7 },
    
    // Rumination
    { type: 'keyword', values: ["can't stop thinking about", 'keeps me up', 'on my mind'], weight: 0.85 },
    
    // Anticipated regret
    { type: 'keyword', values: ['might regret', 'might be a mistake', "shouldn't have"], weight: 0.7 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract concerns and worries.
For each concern:
- statement: What was said
- concern: The worry clearly stated
- domain: What area? "health"|"financial"|"relationship"|"career"|"world"|"self"|"other"
- severity: "minor"|"moderate"|"significant"|"severe"
- likelihood_perceived: How likely do they think it is? 0-1
- controllability: Can they do something? "controllable"|"partially"|"uncontrollable"
- time_orientation: "past"|"present"|"future"
- coping_response: Any coping mentioned?
- recurring: Is this an ongoing worry?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        concern: { type: 'string' },
        domain: { type: 'string' },
        severity: { type: 'string', enum: ['minor', 'moderate', 'significant', 'severe'] },
        likelihood_perceived: { type: 'number', minimum: 0, maximum: 1 },
        controllability: { type: 'string', enum: ['controllable', 'partially', 'uncontrollable'] },
        time_orientation: { type: 'string', enum: ['past', 'present', 'future'] },
        coping_response: { type: ['string', 'null'] },
        recurring: { type: 'boolean' }
      }
    }
  },
  
  tokenBudget: 1500,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Learning/Insight Extraction

```typescript
const learningExtractor: ExtractionProgram = {
  id: 'core_learning',
  name: 'Learning & Insight Extraction',
  type: 'learning',
  version: 1,
  priority: 17,
  
  patterns: [
    // Realizations
    { type: 'keyword', values: ['I realized', 'I learned', "I've come to understand", 'it dawned on me'], weight: 0.95 },
    { type: 'keyword', values: ['now I see', 'now I understand', 'finally get'], weight: 0.9 },
    
    // Insight language
    { type: 'keyword', values: ['insight', 'epiphany', 'breakthrough', 'aha moment'], weight: 0.95 },
    { type: 'keyword', values: ['clicked', 'makes sense now', 'connected the dots'], weight: 0.85 },
    
    // Change in understanding
    { type: 'keyword', values: ['I used to think', 'I now think', 'changed my mind', 'perspective changed'], weight: 0.9 },
    { type: 'keyword', values: ['was wrong about', 'misconception', 'turns out'], weight: 0.85 },
    
    // Lessons
    { type: 'keyword', values: ['lesson learned', 'taught me', 'takeaway is', 'moral of'], weight: 0.9 },
    
    // Growth
    { type: 'keyword', values: ['grown to', 'evolved', "I've changed", "I've developed"], weight: 0.7 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract learnings and insights - moments of understanding or change.
For each learning:
- statement: What was said
- insight: The learning or realization
- type: "realization"|"lesson_learned"|"perspective_shift"|"skill_acquired"|"self_discovery"
- domain: What area?
- source: Where did this learning come from? "experience"|"reflection"|"feedback"|"observation"|"reading"
- impact: How significant? "minor"|"moderate"|"significant"|"transformative"
- previous_belief: What did they think before? (if mentioned)
- application: How will they apply this?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        insight: { type: 'string' },
        type: { type: 'string', enum: ['realization', 'lesson_learned', 'perspective_shift', 'skill_acquired', 'self_discovery'] },
        domain: { type: 'string' },
        source: { type: 'string', enum: ['experience', 'reflection', 'feedback', 'observation', 'reading'] },
        impact: { type: 'string', enum: ['minor', 'moderate', 'significant', 'transformative'] },
        previous_belief: { type: ['string', 'null'] },
        application: { type: ['string', 'null'] }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Change Marker Extraction

```typescript
const changeMarkerExtractor: ExtractionProgram = {
  id: 'core_change_marker',
  name: 'Change Marker Extraction',
  type: 'change_marker',
  version: 1,
  priority: 18,
  
  patterns: [
    // Contrast with past
    { type: 'keyword', values: ['used to', 'no longer', 'not anymore', "don't anymore"], weight: 0.9 },
    { type: 'keyword', values: ['before I', 'now I', 'these days', 'lately'], weight: 0.7 },
    
    // Transition language
    { type: 'keyword', values: ['becoming', 'turning into', 'transitioning', 'shifting'], weight: 0.8 },
    { type: 'keyword', values: ['started to', 'began to', 'stopped'], weight: 0.8 },
    
    // Explicit change
    { type: 'keyword', values: ['things changed', 'everything changed', "I've changed", 'different now'], weight: 0.9 },
    { type: 'keyword', values: ['new', 'fresh start', 'turning point', 'chapter'], weight: 0.7 },
    
    // Growth/decline
    { type: 'keyword', values: ['getting better', 'getting worse', 'improving', 'declining'], weight: 0.7 },
    
    // Life events
    { type: 'keyword', values: ['moved', 'married', 'divorced', 'graduated', 'retired', 'hired', 'fired'], weight: 0.8 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract markers of change - indications something has or is changing.
For each change:
- statement: What was said
- change_description: What changed
- change_type: "behavior"|"belief"|"circumstance"|"relationship"|"identity"|"status"
- before_state: What was it before?
- after_state: What is it now?
- timing: When did this happen?
- cause: What caused the change? (if mentioned)
- valence: Is this change positive, negative, or neutral?
- completeness: "complete"|"in_progress"|"beginning"`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        change_description: { type: 'string' },
        change_type: { type: 'string', enum: ['behavior', 'belief', 'circumstance', 'relationship', 'identity', 'status'] },
        before_state: { type: ['string', 'null'] },
        after_state: { type: ['string', 'null'] },
        timing: { type: ['string', 'null'] },
        cause: { type: ['string', 'null'] },
        valence: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
        completeness: { type: 'string', enum: ['complete', 'in_progress', 'beginning'] }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Hypothetical/Counterfactual Extraction

```typescript
const hypotheticalExtractor: ExtractionProgram = {
  id: 'core_hypothetical',
  name: 'Hypothetical & Counterfactual Extraction',
  type: 'hypothetical',
  version: 1,
  priority: 19,
  
  patterns: [
    // Conditionals
    { type: 'keyword', values: ['if I', 'if only', 'what if', 'suppose'], weight: 0.9 },
    { type: 'keyword', values: ['would have', 'could have', 'should have', 'might have'], weight: 0.9 },
    
    // Counterfactuals
    { type: 'keyword', values: ['wish I had', 'wish I could', "if I hadn't", "if I'd"], weight: 0.9 },
    { type: 'keyword', values: ['different if', 'otherwise', 'instead'], weight: 0.7 },
    
    // Imagination
    { type: 'keyword', values: ['imagine', 'picture', 'envision', 'dream about'], weight: 0.7 },
    
    // Alternate scenarios
    { type: 'keyword', values: ['in another life', 'alternate universe', 'parallel'], weight: 0.8 },
    
    // Speculation
    { type: 'keyword', values: ['probably would', 'likely would', 'might be'], weight: 0.5 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract hypothetical and counterfactual thinking.
For each hypothetical:
- statement: What was said
- hypothetical_scenario: The imagined scenario
- type: "counterfactual_past"|"future_conditional"|"imagination"|"speculation"
- condition: What is the "if" part?
- consequence: What is the "then" part?
- emotional_charge: What emotion accompanies this? 
- regret_level: If counterfactual, how much regret? 0-1
- probability_assessed: How likely do they think this is?`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        hypothetical_scenario: { type: 'string' },
        type: { type: 'string', enum: ['counterfactual_past', 'future_conditional', 'imagination', 'speculation'] },
        condition: { type: ['string', 'null'] },
        consequence: { type: ['string', 'null'] },
        emotional_charge: { type: ['string', 'null'] },
        regret_level: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        probability_assessed: { type: ['number', 'null'], minimum: 0, maximum: 1 }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

### Commitment Extraction

```typescript
const commitmentExtractor: ExtractionProgram = {
  id: 'core_commitment',
  name: 'Commitment Extraction',
  type: 'commitment',
  version: 1,
  priority: 20,
  
  patterns: [
    // Promises
    { type: 'keyword', values: ['I promise', 'I commit', 'I swear', 'I vow'], weight: 0.95 },
    { type: 'keyword', values: ['my word', 'guaranteed', 'absolutely will'], weight: 0.9 },
    
    // Obligations
    { type: 'keyword', values: ['I owe', 'I have to', 'I must', 'obligated to'], weight: 0.8 },
    { type: 'keyword', values: ['responsible for', 'accountable for', 'on the hook'], weight: 0.8 },
    
    // Agreements
    { type: 'keyword', values: ['agreed to', 'said yes to', 'signed up for', 'volunteered'], weight: 0.85 },
    { type: 'keyword', values: ['deal', 'agreement', 'contract', 'arrangement'], weight: 0.7 },
    
    // Deadlines
    { type: 'keyword', values: ['by', 'deadline', 'due', 'expected by'], weight: 0.6 },
    
    // Social commitments
    { type: 'keyword', values: ['meeting', 'appointment', 'scheduled', 'plans with'], weight: 0.6 }
  ],
  
  relevanceScorer: { type: 'weighted_sum' },
  
  extractionPrompt: `Extract commitments - promises and obligations.
For each commitment:
- statement: What was said
- commitment: What is the commitment
- to_whom: Who is this commitment to? (self, person, organization)
- type: "promise"|"obligation"|"agreement"|"social"|"self"
- deadline: When is this due?
- stakes: What happens if not fulfilled?
- current_status: "pending"|"in_progress"|"at_risk"|"fulfilled"|"broken"
- confidence: How confident are they in fulfilling it? 0-1`,
  
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        commitment: { type: 'string' },
        to_whom: { type: 'string' },
        type: { type: 'string', enum: ['promise', 'obligation', 'agreement', 'social', 'self'] },
        deadline: { type: ['string', 'null'] },
        stakes: { type: ['string', 'null'] },
        current_status: { type: 'string', enum: ['pending', 'in_progress', 'at_risk', 'fulfilled', 'broken'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  },
  
  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

---

## Layer 5: Thought Chain System (Simplified)

### Automatic Chain Management

The user just talks. The system automatically organizes into chains.

```typescript
interface ChainManager {
  // Called after each extraction
  processNewClaims(
    unitId: string,
    claims: ExtractedClaim[],
    sessionContext: SessionContext
  ): Promise<ChainUpdate[]>;
}

interface SessionContext {
  sessionId: string;
  activeChains: ThoughtChain[]; // Chains active in this session
  recentClaims: Claim[]; // Last N claims for context
}

interface ChainUpdate {
  type: 'extend' | 'create' | 'branch' | 'merge' | 'conclude';
  chainId: string;
  claimIds: string[];
  reasoning?: string;
}
```

### Chain Detection Logic

```typescript
async function processNewClaims(
  unitId: string,
  claims: ExtractedClaim[],
  context: SessionContext
): Promise<ChainUpdate[]> {
  const updates: ChainUpdate[] = [];
  
  for (const claim of claims) {
    // 1. Check for topic continuity with active chains
    const relatedChain = await findRelatedChain(claim, context.activeChains);
    
    if (relatedChain) {
      // Calculate semantic distance (simple heuristics, no embeddings)
      const distance = calculateTopicDistance(claim, relatedChain);
      
      if (distance < CONTINUE_THRESHOLD) {
        // Continue existing chain
        updates.push({
          type: 'extend',
          chainId: relatedChain.id,
          claimIds: [claim.id]
        });
      } else if (distance < BRANCH_THRESHOLD) {
        // Branch from existing chain
        const newChainId = generateId();
        updates.push({
          type: 'branch',
          chainId: newChainId,
          claimIds: [claim.id],
          reasoning: `Branched from "${relatedChain.topic}" due to topic shift`
        });
      }
    } else {
      // Check for dormant chains that might be revived
      const dormantChain = await findRelatedDormantChain(claim);
      
      if (dormantChain) {
        // Revive dormant chain
        updates.push({
          type: 'extend',
          chainId: dormantChain.id,
          claimIds: [claim.id],
          reasoning: `Revived chain about "${dormantChain.topic}"`
        });
      } else {
        // Start new chain
        const topic = await extractTopic(claim);
        const newChainId = generateId();
        updates.push({
          type: 'create',
          chainId: newChainId,
          claimIds: [claim.id],
          reasoning: `New topic: "${topic}"`
        });
      }
    }
  }
  
  return updates;
}
```

### Topic Distance Calculation (No Embeddings)

```typescript
function calculateTopicDistance(claim: Claim, chain: ThoughtChain): number {
  let score = 0;
  
  // 1. Entity overlap
  const chainEntities = getChainEntities(chain);
  const claimEntities = extractEntitiesFromClaim(claim);
  const entityOverlap = intersection(chainEntities, claimEntities).size;
  score += entityOverlap * 0.3;
  
  // 2. Subject similarity (fuzzy string matching)
  const subjectSimilarity = fuzzyMatch(claim.subject, chain.topic);
  score += subjectSimilarity * 0.3;
  
  // 3. Keyword overlap
  const chainKeywords = extractKeywords(chain);
  const claimKeywords = extractKeywords(claim.statement);
  const keywordOverlap = jaccardSimilarity(chainKeywords, claimKeywords);
  score += keywordOverlap * 0.2;
  
  // 4. Temporal proximity
  const timeSinceChainActive = Date.now() - chain.last_extended;
  const timeDecay = Math.exp(-timeSinceChainActive / (24 * 60 * 60 * 1000)); // Decay over 24h
  score += timeDecay * 0.2;
  
  // Convert to distance (lower = more related)
  return 1 - Math.min(score, 1);
}
```

### Chain Lifecycle

```
                  ┌──────────────┐
   New Topic ────►│   ACTIVE     │◄──── Revival
                  │              │
                  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    (continues)    (time passes)   (explicit end)
          │              │              │
          ▼              ▼              ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │   ACTIVE     │ │   DORMANT    │ │  CONCLUDED   │
   │  (extended)  │ │              │ │              │
   └──────────────┘ └──────────────┘ └──────────────┘
```

### Session Boundary Handling

When a session ends:

```typescript
async function handleSessionEnd(sessionId: string): Promise<void> {
  // 1. Mark all active chains as potentially dormant
  const activeChains = await getActiveChains(sessionId);
  
  for (const chain of activeChains) {
    // Don't immediately mark dormant - give 24h window
    await scheduleTask({
      type: 'check_chain_dormancy',
      chainId: chain.id,
      executeAt: Date.now() + 24 * 60 * 60 * 1000
    });
  }
  
  // 2. Generate session summary
  await scheduleTask({
    type: 'generate_session_summary',
    sessionId: sessionId,
    executeAt: Date.now()
  });
}
```

---

## Layer 6: Goal System (Enhanced)

### Goal Structure

```typescript
interface Goal {
  id: string;
  statement: string;
  
  // Type classification
  goal_type: 'outcome' | 'process' | 'identity' | 'avoidance' | 'maintenance';
  
  // Temporal
  timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'life';
  deadline: number | null;
  
  // Hierarchy
  parent_goal_id: string | null;
  child_goal_ids: string[];
  
  // Status
  status: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'dormant' | 'superseded';
  
  // Progress
  progress_type: 'binary' | 'percentage' | 'milestone' | 'continuous';
  progress_value: number; // 0-100 for percentage, milestone count, etc.
  milestones: Milestone[];
  
  // Blockers
  blockers: Blocker[];
  
  // Motivation
  motivation: string;
  underlying_value_ids: string[];
  
  // Evidence
  source_claim_ids: string[];
  evidence_claim_ids: string[];
  
  // Metadata
  created_at: number;
  last_referenced: number;
  priority: number;
}

interface Milestone {
  id: string;
  description: string;
  status: 'pending' | 'achieved' | 'skipped';
  achieved_at: number | null;
  evidence_claim_id: string | null;
}

interface Blocker {
  id: string;
  description: string;
  type: 'resource' | 'knowledge' | 'skill' | 'external' | 'internal' | 'dependency';
  severity: 'minor' | 'significant' | 'blocking';
  status: 'active' | 'resolved' | 'accepted';
  resolution_path: string | null;
}
```

### Goal Tree Visualization

```typescript
interface GoalTree {
  // Life-level goals at root
  roots: GoalNode[];
}

interface GoalNode {
  goal: Goal;
  children: GoalNode[];
  
  // Computed metrics
  overall_progress: number;
  health_status: 'healthy' | 'at_risk' | 'stalled' | 'blocked';
  attention_needed: boolean;
}

function buildGoalTree(goals: Goal[]): GoalTree {
  // Find roots (goals with no parent)
  const roots = goals.filter(g => !g.parent_goal_id);
  
  // Recursively build tree
  return {
    roots: roots.map(root => buildGoalNode(root, goals))
  };
}

function buildGoalNode(goal: Goal, allGoals: Goal[]): GoalNode {
  const children = allGoals.filter(g => g.parent_goal_id === goal.id);
  
  const childNodes = children.map(c => buildGoalNode(c, allGoals));
  
  // Calculate overall progress (weighted average of children if has children)
  const overall_progress = childNodes.length > 0
    ? childNodes.reduce((sum, n) => sum + n.overall_progress, 0) / childNodes.length
    : goal.progress_value;
  
  // Determine health status
  const health_status = calculateHealthStatus(goal, childNodes);
  
  return {
    goal,
    children: childNodes,
    overall_progress,
    health_status,
    attention_needed: health_status === 'blocked' || health_status === 'stalled'
  };
}
```

### Goal Observer

```typescript
const goalObserver: Observer = {
  id: 'observer_goals',
  type: 'goal_observer',
  
  triggers: [
    { type: 'new_claim', claimType: 'goal' },
    { type: 'new_claim', claimType: 'intention' },
    { type: 'schedule', pattern: 'daily' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];
    
    // 1. Check for new goals from claims
    const goalClaims = context.newClaims.filter(c => c.claim_type === 'goal');
    for (const claim of goalClaims) {
      const existingGoal = await findSimilarGoal(claim);
      if (existingGoal) {
        // Update existing goal
        outputs.push({
          type: 'goal_update',
          goalId: existingGoal.id,
          update: { last_referenced: Date.now() }
        });
      } else {
        // Create new goal
        outputs.push({
          type: 'goal_create',
          goal: await constructGoalFromClaim(claim)
        });
      }
    }
    
    // 2. Check for progress indicators
    const progressClaims = context.newClaims.filter(c => 
      c.statement.toLowerCase().includes('progress') ||
      c.statement.toLowerCase().includes('done') ||
      c.statement.toLowerCase().includes('finished') ||
      c.statement.toLowerCase().includes('completed')
    );
    
    for (const claim of progressClaims) {
      const relatedGoal = await findRelatedGoal(claim);
      if (relatedGoal) {
        outputs.push({
          type: 'goal_progress',
          goalId: relatedGoal.id,
          claim: claim,
          suggestedProgress: await estimateProgress(claim, relatedGoal)
        });
      }
    }
    
    // 3. Check for blockers
    const blockerClaims = context.newClaims.filter(c =>
      c.claim_type === 'concern' ||
      c.statement.toLowerCase().includes('stuck') ||
      c.statement.toLowerCase().includes("can't") ||
      c.statement.toLowerCase().includes('blocked')
    );
    
    for (const claim of blockerClaims) {
      const relatedGoal = await findRelatedGoal(claim);
      if (relatedGoal) {
        outputs.push({
          type: 'blocker_detected',
          goalId: relatedGoal.id,
          blocker: await constructBlockerFromClaim(claim)
        });
      }
    }
    
    // 4. Daily: Check for stale goals
    if (context.trigger.type === 'schedule') {
      const staleGoals = await findStaleGoals();
      for (const goal of staleGoals) {
        outputs.push({
          type: 'goal_stale',
          goalId: goal.id,
          daysSinceReference: daysSince(goal.last_referenced)
        });
      }
    }
    
    return outputs;
  }
};
```

### Goal Hierarchy Inference

```typescript
async function inferGoalHierarchy(newGoal: Goal, existingGoals: Goal[]): Promise<string | null> {
  // Use LLM to determine if this goal is a sub-goal of an existing goal
  
  const prompt = `Given these existing goals:
${existingGoals.map((g, i) => `${i + 1}. ${g.statement} (${g.timeframe})`).join('\n')}

And this new goal:
"${newGoal.statement}" (${newGoal.timeframe})

Is the new goal a sub-goal or component of any existing goal? If yes, which one?
Respond with the number of the parent goal, or "none" if it's independent.`;

  const response = await llm.complete({ prompt });
  
  if (response === 'none') return null;
  
  const parentIndex = parseInt(response) - 1;
  return existingGoals[parentIndex]?.id || null;
}
```

---

## Layer 7: Durable Queue System

### Queue Design (Browser-Safe)

```typescript
interface DurableQueue {
  // Enqueue a task
  enqueue(task: Task): Promise<string>;
  
  // Process next available task
  processNext(): Promise<ProcessResult | null>;
  
  // Get queue status
  getStatus(): Promise<QueueStatus>;
  
  // Recover from interruption
  recover(): Promise<number>; // Returns number of recovered tasks
}

interface Task {
  id?: string;
  type: TaskType;
  payload: any;
  priority: number;
  maxAttempts: number;
  executeAt: number; // Scheduled time
}

type TaskType = 
  | 'extract_from_unit'
  | 'run_observer'
  | 'consolidate_memory'
  | 'check_chain_dormancy'
  | 'generate_session_summary'
  | 'decay_claims'
  | 'check_goal_progress'
  | 'generate_synthesis';

interface ProcessResult {
  taskId: string;
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
}
```

### Implementation

```typescript
class IndexedDBDurableQueue implements DurableQueue {
  private store: TinyBaseStore;
  private processing: Set<string> = new Set();
  private readonly STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  constructor(store: TinyBaseStore) {
    this.store = store;
  }
  
  async enqueue(task: Task): Promise<string> {
    const id = task.id || generateId();
    
    await this.store.setRow('task_queue', id, {
      task_type: task.type,
      payload_json: JSON.stringify(task.payload),
      status: 'pending',
      attempts: 0,
      max_attempts: task.maxAttempts,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      error: null,
      priority: task.priority,
      execute_at: task.executeAt
    });
    
    return id;
  }
  
  async processNext(): Promise<ProcessResult | null> {
    // Get next available task
    const task = await this.getNextTask();
    if (!task) return null;
    
    const taskId = task.id;
    
    // Mark as processing
    await this.store.setRow('task_queue', taskId, {
      ...task,
      status: 'processing',
      started_at: Date.now(),
      attempts: task.attempts + 1
    });
    
    this.processing.add(taskId);
    
    try {
      const startTime = Date.now();
      const output = await this.executeTask(task);
      const duration = Date.now() - startTime;
      
      // Mark as completed
      await this.store.setRow('task_queue', taskId, {
        ...task,
        status: 'completed',
        completed_at: Date.now(),
        attempts: task.attempts + 1
      });
      
      this.processing.delete(taskId);
      
      return { taskId, success: true, output, duration };
      
    } catch (error) {
      const shouldRetry = task.attempts + 1 < task.max_attempts;
      
      await this.store.setRow('task_queue', taskId, {
        ...task,
        status: shouldRetry ? 'pending' : 'failed',
        error: error.message,
        attempts: task.attempts + 1
      });
      
      this.processing.delete(taskId);
      
      return { 
        taskId, 
        success: false, 
        error: error.message,
        duration: Date.now() - task.started_at 
      };
    }
  }
  
  async recover(): Promise<number> {
    // Find tasks that were processing but never completed (crash recovery)
    const allTasks = this.store.getTable('task_queue');
    let recovered = 0;
    
    for (const [id, task] of Object.entries(allTasks)) {
      if (task.status === 'processing') {
        const staleTime = Date.now() - task.started_at;
        
        if (staleTime > this.STALE_THRESHOLD) {
          // Task was interrupted - reset to pending if retries remain
          const shouldRetry = task.attempts < task.max_attempts;
          
          await this.store.setRow('task_queue', id, {
            ...task,
            status: shouldRetry ? 'pending' : 'failed',
            error: shouldRetry ? null : 'Task interrupted and max retries exceeded'
          });
          
          recovered++;
        }
      }
    }
    
    return recovered;
  }
  
  private async getNextTask(): Promise<any | null> {
    const now = Date.now();
    const allTasks = this.store.getTable('task_queue');
    
    // Filter for pending tasks that are ready to execute
    const pendingTasks = Object.entries(allTasks)
      .filter(([id, task]) => 
        task.status === 'pending' && 
        task.execute_at <= now &&
        !this.processing.has(id)
      )
      .map(([id, task]) => ({ id, ...task }));
    
    if (pendingTasks.length === 0) return null;
    
    // Sort by priority (higher first) then by created_at (older first)
    pendingTasks.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.created_at - b.created_at;
    });
    
    return pendingTasks[0];
  }
  
  private async executeTask(task: any): Promise<any> {
    const payload = JSON.parse(task.payload_json);
    
    switch (task.task_type as TaskType) {
      case 'extract_from_unit':
        return await extractionPipeline.process(payload.unitId);
        
      case 'run_observer':
        return await observerSystem.runObserver(payload.observerId, payload.context);
        
      case 'consolidate_memory':
        return await memorySystem.consolidate(payload.sessionId);
        
      case 'check_chain_dormancy':
        return await chainManager.checkDormancy(payload.chainId);
        
      case 'generate_session_summary':
        return await synthesizer.generateSessionSummary(payload.sessionId);
        
      case 'decay_claims':
        return await memorySystem.decayAllClaims();
        
      case 'check_goal_progress':
        return await goalSystem.checkProgress(payload.goalId);
        
      case 'generate_synthesis':
        return await synthesizer.generate(payload.type, payload.params);
        
      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }
}
```

### Queue Runner

```typescript
class QueueRunner {
  private queue: DurableQueue;
  private running: boolean = false;
  private pollInterval: number = 1000; // 1 second
  
  constructor(queue: DurableQueue) {
    this.queue = queue;
  }
  
  async start(): Promise<void> {
    if (this.running) return;
    
    // Recover any interrupted tasks
    const recovered = await this.queue.recover();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} interrupted tasks`);
    }
    
    this.running = true;
    this.poll();
  }
  
  stop(): void {
    this.running = false;
  }
  
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.queue.processNext();
        
        if (result) {
          console.log(`Task ${result.taskId}: ${result.success ? 'success' : 'failed'} (${result.duration}ms)`);
        } else {
          // No tasks available, wait before polling again
          await sleep(this.pollInterval);
        }
      } catch (error) {
        console.error('Queue processing error:', error);
        await sleep(this.pollInterval);
      }
    }
  }
}

// Visibility API integration for browser
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    queueRunner.start();
  } else {
    // Continue processing for a bit, then pause
    setTimeout(() => {
      if (document.visibilityState === 'hidden') {
        queueRunner.stop();
      }
    }, 5000);
  }
});
```

---

## Layer 8: Observer System

### Observer Architecture

```typescript
interface Observer {
  id: string;
  type: ObserverType;
  
  // When to run
  triggers: ObserverTrigger[];
  
  // What to do
  process: (context: ObserverContext) => Promise<ObserverOutput[]>;
  
  // Priority (for ordering when multiple observers triggered)
  priority: number;
  
  // Active state
  active: boolean;
}

type ObserverType = 
  | 'pattern_observer'
  | 'concern_observer'
  | 'goal_observer'
  | 'contradiction_observer'
  | 'narrative_observer'
  | 'relationship_observer'
  | 'consolidation_observer';

interface ObserverTrigger {
  type: 'new_claim' | 'claim_update' | 'session_end' | 'schedule' | 'manual';
  claimType?: string; // For new_claim triggers
  pattern?: string; // For schedule triggers (cron-like)
}

interface ObserverContext {
  trigger: ObserverTrigger;
  newClaims: Claim[];
  sessionId: string | null;
  timestamp: number;
}

interface ObserverOutput {
  type: string;
  [key: string]: any;
}
```

### Core Observers

```typescript
// Pattern Observer - Detects recurring themes
const patternObserver: Observer = {
  id: 'observer_patterns',
  type: 'pattern_observer',
  priority: 5,
  active: true,
  
  triggers: [
    { type: 'schedule', pattern: 'every_10_claims' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const recentClaims = await getRecentClaims(50);
    const outputs: ObserverOutput[] = [];
    
    // Group claims by subject
    const subjectGroups = groupBy(recentClaims, 'subject');
    
    for (const [subject, claims] of Object.entries(subjectGroups)) {
      if (claims.length >= 3) {
        // Check if this is a new pattern
        const existingPattern = await findPattern(subject);
        
        if (existingPattern) {
          outputs.push({
            type: 'pattern_reinforced',
            patternId: existingPattern.id,
            newClaimIds: claims.map(c => c.id)
          });
        } else {
          outputs.push({
            type: 'pattern_detected',
            pattern: {
              pattern_type: 'recurring_topic',
              description: `Recurring discussion of: ${subject}`,
              evidence_claims: claims.map(c => c.id)
            }
          });
        }
      }
    }
    
    // Also check for emotional patterns
    const emotionalClaims = recentClaims.filter(c => c.emotional_intensity > 0.5);
    const emotionGroups = groupBy(emotionalClaims, 'emotional_valence', 
      v => v > 0.3 ? 'positive' : v < -0.3 ? 'negative' : 'neutral');
    
    if (emotionGroups['negative']?.length >= 3) {
      outputs.push({
        type: 'pattern_detected',
        pattern: {
          pattern_type: 'emotional_pattern',
          description: 'Recurring negative emotional expressions',
          evidence_claims: emotionGroups['negative'].map(c => c.id)
        }
      });
    }
    
    return outputs;
  }
};

// Concern Observer - Tracks worries and their evolution
const concernObserver: Observer = {
  id: 'observer_concerns',
  type: 'concern_observer',
  priority: 4,
  active: true,
  
  triggers: [
    { type: 'new_claim', claimType: 'concern' },
    { type: 'schedule', pattern: 'daily' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];
    
    // Track new concerns
    const concernClaims = context.newClaims.filter(c => 
      c.claim_type === 'concern' || 
      c.emotional_valence < -0.3 && c.emotional_intensity > 0.5
    );
    
    for (const claim of concernClaims) {
      // Check if this relates to existing concern
      const existingConcern = await findRelatedConcern(claim);
      
      if (existingConcern) {
        outputs.push({
          type: 'concern_continued',
          concernId: existingConcern.id,
          newClaimId: claim.id
        });
      } else {
        outputs.push({
          type: 'concern_new',
          claim: claim
        });
      }
    }
    
    // Daily: Check for resolved concerns
    if (context.trigger.type === 'schedule') {
      const activeConcerns = await getActiveConcerns();
      
      for (const concern of activeConcerns) {
        // Check if recent claims indicate resolution
        const recentRelated = await getRecentClaimsAbout(concern.subject, 7);
        const resolvedIndicators = recentRelated.filter(c =>
          c.emotional_valence > 0.3 ||
          c.statement.toLowerCase().includes('resolved') ||
          c.statement.toLowerCase().includes('better') ||
          c.statement.toLowerCase().includes('figured out')
        );
        
        if (resolvedIndicators.length > 0) {
          outputs.push({
            type: 'concern_possibly_resolved',
            concernId: concern.id,
            evidence: resolvedIndicators.map(c => c.id)
          });
        }
      }
    }
    
    return outputs;
  }
};

// Contradiction Observer - Detects conflicting beliefs
const contradictionObserver: Observer = {
  id: 'observer_contradictions',
  type: 'contradiction_observer',
  priority: 3,
  active: true,
  
  triggers: [
    { type: 'new_claim', claimType: 'belief' },
    { type: 'new_claim', claimType: 'factual' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];
    
    for (const claim of context.newClaims) {
      // Find claims about the same subject
      const relatedClaims = await getClaimsAboutSubject(claim.subject, {
        excludeId: claim.id,
        state: 'active'
      });
      
      // Use LLM to check for contradictions
      if (relatedClaims.length > 0) {
        const contradictions = await detectContradictions(claim, relatedClaims);
        
        for (const contradiction of contradictions) {
          outputs.push({
            type: 'contradiction_detected',
            newClaimId: claim.id,
            existingClaimId: contradiction.claimId,
            contradictionType: contradiction.type,
            explanation: contradiction.explanation
          });
        }
      }
    }
    
    return outputs;
  }
};

// Narrative Observer - Identifies recurring stories and self-narratives
const narrativeObserver: Observer = {
  id: 'observer_narrative',
  type: 'narrative_observer',
  priority: 2,
  active: true,
  
  triggers: [
    { type: 'schedule', pattern: 'weekly' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    // Get self-perception claims
    const selfClaims = await getClaimsByType('self_perception', { limit: 50 });
    
    // Get memory references (stories they tell)
    const memoryClaims = await getClaimsByType('memory_reference', { limit: 50 });
    
    // Use LLM to identify narrative patterns
    const narrativeAnalysis = await analyzeNarratives(selfClaims, memoryClaims);
    
    return [{
      type: 'narrative_analysis',
      dominantSelfNarratives: narrativeAnalysis.selfNarratives,
      recurringStories: narrativeAnalysis.recurringStories,
      identityThemes: narrativeAnalysis.identityThemes
    }];
  }
};

// Relationship Observer - Tracks interpersonal dynamics
const relationshipObserver: Observer = {
  id: 'observer_relationships',
  type: 'relationship_observer',
  priority: 4,
  active: true,
  
  triggers: [
    { type: 'new_claim', claimType: 'relationship' },
    { type: 'schedule', pattern: 'weekly' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];
    
    // Track new relationship mentions
    const relationshipClaims = context.newClaims.filter(c => 
      c.claim_type === 'relationship'
    );
    
    for (const claim of relationshipClaims) {
      // Update relationship entity
      outputs.push({
        type: 'relationship_update',
        claim: claim
      });
    }
    
    // Weekly: Generate relationship health report
    if (context.trigger.type === 'schedule') {
      const allRelationshipClaims = await getClaimsByType('relationship', { limit: 100 });
      const relationships = await buildRelationshipMap(allRelationshipClaims);
      
      outputs.push({
        type: 'relationship_report',
        relationships: relationships,
        dynamics: await analyzeRelationshipDynamics(relationships)
      });
    }
    
    return outputs;
  }
};

// Consolidation Observer - Memory consolidation
const consolidationObserver: Observer = {
  id: 'observer_consolidation',
  type: 'consolidation_observer',
  priority: 1,
  active: true,
  
  triggers: [
    { type: 'session_end' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const sessionClaims = await getSessionClaims(context.sessionId);
    const outputs: ObserverOutput[] = [];
    
    for (const claim of sessionClaims) {
      // Calculate consolidation score
      const score = calculateConsolidationScore(claim);
      
      if (score >= CONSOLIDATION_THRESHOLD) {
        outputs.push({
          type: 'consolidate_to_long_term',
          claimId: claim.id,
          score: score,
          factors: getConsolidationFactors(claim)
        });
      }
    }
    
    return outputs;
  }
};

function calculateConsolidationScore(claim: Claim): number {
  let score = 0;
  
  // Emotional intensity
  score += claim.emotional_intensity * 0.3;
  
  // High stakes
  if (claim.stakes === 'high' || claim.stakes === 'existential') {
    score += 0.3;
  }
  
  // Repeated mentions
  score += Math.min(claim.confirmation_count * 0.1, 0.2);
  
  // Explicit importance markers
  if (claim.statement.toLowerCase().includes('important') ||
      claim.statement.toLowerCase().includes('remember')) {
    score += 0.2;
  }
  
  return Math.min(score, 1);
}
```

### Observer Dispatcher

```typescript
class ObserverDispatcher {
  private observers: Map<string, Observer> = new Map();
  private queue: DurableQueue;
  
  constructor(queue: DurableQueue) {
    this.queue = queue;
    
    // Register core observers
    this.register(patternObserver);
    this.register(concernObserver);
    this.register(contradictionObserver);
    this.register(narrativeObserver);
    this.register(relationshipObserver);
    this.register(consolidationObserver);
    this.register(goalObserver);
  }
  
  register(observer: Observer): void {
    this.observers.set(observer.id, observer);
  }
  
  async dispatch(event: ObserverEvent): Promise<void> {
    // Find all observers that should trigger
    const triggeredObservers = Array.from(this.observers.values())
      .filter(obs => obs.active && this.shouldTrigger(obs, event))
      .sort((a, b) => b.priority - a.priority);
    
    // Queue observer tasks
    for (const observer of triggeredObservers) {
      await this.queue.enqueue({
        type: 'run_observer',
        payload: {
          observerId: observer.id,
          context: {
            trigger: event.trigger,
            newClaims: event.newClaims || [],
            sessionId: event.sessionId,
            timestamp: Date.now()
          }
        },
        priority: observer.priority,
        maxAttempts: 3,
        executeAt: Date.now()
      });
    }
  }
  
  private shouldTrigger(observer: Observer, event: ObserverEvent): boolean {
    return observer.triggers.some(trigger => {
      if (trigger.type !== event.trigger.type) return false;
      
      if (trigger.type === 'new_claim' && trigger.claimType) {
        return event.newClaims?.some(c => c.claim_type === trigger.claimType);
      }
      
      return true;
    });
  }
}
```

---

## Layer 9: Additional Essential Components for Mind Modeling

### 1. Attention/Salience System

What's top of mind right now?

```typescript
interface AttentionSystem {
  // Get currently salient topics/entities/goals
  getTopOfMind(): Promise<TopOfMind>;
  
  // Update salience based on new input
  updateSalience(unitId: string): Promise<void>;
}

interface TopOfMind {
  topics: Array<{ topic: string; salience: number; lastMentioned: number }>;
  entities: Array<{ entity: string; salience: number }>;
  goals: Array<{ goalId: string; salience: number }>;
  concerns: Array<{ concern: string; salience: number }>;
  openQuestions: Array<{ question: string; salience: number }>;
}

// Salience decays over time but spikes with mentions
function calculateSalience(item: SalienceItem): number {
  const timeSinceLastMention = Date.now() - item.lastMentioned;
  const decayFactor = Math.exp(-timeSinceLastMention / SALIENCE_HALFLIFE);
  
  return item.baseSalience * decayFactor * item.mentionBoost;
}
```

### 2. Worldview/Mental Model System

How does this person understand the world to work?

```typescript
interface WorldModel {
  // Domain-specific beliefs about how things work
  domains: Map<string, DomainModel>;
  
  // Core assumptions
  assumptions: Assumption[];
  
  // Heuristics they use
  heuristics: Heuristic[];
}

interface DomainModel {
  domain: string; // "work", "relationships", "health", etc.
  
  // Causal beliefs in this domain
  causalBeliefs: CausalBelief[];
  
  // What they consider important
  priorities: string[];
  
  // Their typical approach
  defaultStrategies: string[];
  
  // Known exceptions
  exceptions: string[];
}

interface Assumption {
  statement: string;
  domain: string;
  implicitness: 'explicit' | 'inferred';
  sourceClaimIds: string[];
}

interface Heuristic {
  statement: string; // e.g., "Always sleep on big decisions"
  domain: string;
  reliability: number; // How often they follow it
  sourceClaimIds: string[];
}
```

### 3. Temporal Self System

Past, present, and future self-concept

```typescript
interface TemporalSelf {
  // Who they were
  pastSelf: SelfSnapshot[];
  
  // Who they are now
  currentSelf: CurrentSelfModel;
  
  // Who they want to become
  futureSelf: FutureSelfModel;
  
  // Continuity - what connects these
  continuityNarrative: string;
}

interface SelfSnapshot {
  timeperiod: string;
  description: string;
  keyTraits: string[];
  keyEvents: string[];
  relationship_to_current: 'evolved_from' | 'reacted_against' | 'continuous_with';
}

interface CurrentSelfModel {
  coreIdentity: string[];
  roles: string[];
  traits: Array<{ trait: string; confidence: number }>;
  strengths: string[];
  weaknesses: string[];
  currentChallenges: string[];
}

interface FutureSelfModel {
  aspirationalTraits: string[];
  goalIdentities: string[]; // "the kind of person who..."
  fears: string[]; // What they don't want to become
  expectedChanges: string[];
}
```

### 4. Social Context System

Their social world and relationships

```typescript
interface SocialWorld {
  // Important people
  significantOthers: Map<string, Person>;
  
  // Groups they belong to
  groups: Group[];
  
  // Social roles they play
  roles: SocialRole[];
  
  // Social support network
  supportNetwork: SupportNetwork;
}

interface Person {
  name: string;
  relationship: string;
  closeness: number;
  trust: number;
  frequency_of_contact: string;
  
  // Dynamics
  typical_interactions: string[];
  tensions: string[];
  shared_history: string[];
  
  // Claims about this person
  claimIds: string[];
}

interface Group {
  name: string;
  type: 'family' | 'friends' | 'work' | 'community' | 'interest';
  role_in_group: string;
  importance: number;
  dynamics: string;
}

interface SupportNetwork {
  emotional_support: string[]; // Who they turn to
  practical_support: string[];
  advice_giving: string[];
  perceived_adequacy: number;
}
```

### 5. Resource/Constraint Awareness

What resources and constraints shape their life?

```typescript
interface LifeContext {
  // Resources
  resources: {
    time: TimeResource;
    energy: EnergyResource;
    financial: FinancialResource;
    social: SocialResource;
    knowledge: KnowledgeResource;
  };
  
  // Constraints
  constraints: Constraint[];
  
  // Current life stage
  lifeStage: string;
  
  // Major responsibilities
  responsibilities: string[];
}

interface TimeResource {
  perceived_availability: 'abundant' | 'adequate' | 'scarce' | 'desperate';
  major_time_sinks: string[];
  protected_time: string[]; // What they prioritize
}

interface EnergyResource {
  typical_level: 'high' | 'moderate' | 'low' | 'variable';
  drains: string[];
  sources: string[];
}

interface Constraint {
  type: 'health' | 'financial' | 'geographic' | 'relational' | 'professional' | 'other';
  description: string;
  impact: 'minor' | 'significant' | 'major';
  changeable: boolean;
}
```

### 6. Decision Style System

How do they make decisions?

```typescript
interface DecisionStyle {
  // General tendencies
  tendencies: {
    speed: 'impulsive' | 'quick' | 'deliberate' | 'slow';
    information_seeking: 'minimal' | 'moderate' | 'extensive';
    risk_tolerance: 'risk_averse' | 'moderate' | 'risk_seeking';
    social_consultation: 'independent' | 'selective' | 'collaborative';
    reversibility_preference: 'prefers_reversible' | 'neutral' | 'commits_fully';
  };
  
  // Domain-specific approaches
  domainApproaches: Map<string, DecisionApproach>;
  
  // Known biases (from their own reflection)
  acknowledgedBiases: string[];
  
  // Decision regrets (informative of style)
  regretPatterns: string[];
}

interface DecisionApproach {
  domain: string;
  typical_process: string;
  decision_criteria: string[];
  who_they_consult: string[];
}
```

### 7. Coping & Response Patterns

How do they handle adversity?

```typescript
interface CopingPatterns {
  // Primary coping strategies
  primaryStrategies: CopingStrategy[];
  
  // Stress responses
  stressResponses: {
    behavioral: string[];
    emotional: string[];
    cognitive: string[];
    physical: string[];
  };
  
  // What they do when overwhelmed
  overloadResponse: string;
  
  // Recovery patterns
  recoveryStrategies: string[];
  
  // Support seeking patterns
  supportSeeking: {
    tendency: 'rarely' | 'sometimes' | 'often' | 'readily';
    preferred_sources: string[];
    barriers: string[];
  };
}

interface CopingStrategy {
  strategy: string;
  type: 'problem_focused' | 'emotion_focused' | 'avoidance' | 'social' | 'meaning_making';
  effectiveness: number; // Self-rated
  when_used: string;
}
```

### Observer for Mind Model Synthesis

```typescript
const mindModelObserver: Observer = {
  id: 'observer_mind_model',
  type: 'narrative_observer',
  priority: 1,
  active: true,
  
  triggers: [
    { type: 'schedule', pattern: 'weekly' }
  ],
  
  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    // Gather all relevant claims
    const selfClaims = await getClaimsByType('self_perception');
    const beliefClaims = await getClaimsByType('claim_belief');
    const causalClaims = await getClaimsByType('causal');
    const decisionClaims = await getClaimsByType('decision');
    const relationshipClaims = await getClaimsByType('relationship');
    const valueClaims = await getClaimsByType('value');
    const goalClaims = await getClaimsByType('goal');
    const emotionClaims = await getClaimsByType('emotion');
    const concernClaims = await getClaimsByType('concern');
    
    // Generate comprehensive mind model synthesis
    const mindModel = await synthesizeMindModel({
      selfClaims,
      beliefClaims,
      causalClaims,
      decisionClaims,
      relationshipClaims,
      valueClaims,
      goalClaims,
      emotionClaims,
      concernClaims
    });
    
    return [{
      type: 'mind_model_synthesis',
      model: mindModel
    }];
  }
};
```

---

## Layer 10: Summary - Putting It All Together

### System Initialization

```typescript
async function initializeRAMBLE(): Promise<RambleSystem> {
  // 1. Initialize TinyBase store
  const store = createStore();
  const persister = createIndexedDbPersister(store, 'ramble-store');
  await persister.load();
  
  // 2. Initialize durable queue
  const queue = new IndexedDBDurableQueue(store);
  const queueRunner = new QueueRunner(queue);
  
  // 3. Initialize core systems
  const extractionPipeline = new ExtractionPipeline(store, queue);
  const chainManager = new ChainManager(store);
  const memorySystem = new MemorySystem(store);
  const goalSystem = new GoalSystem(store);
  const observerDispatcher = new ObserverDispatcher(queue);
  const extensionRegistry = new ExtensionRegistry(store);
  const synthesizer = new Synthesizer(store, extensionRegistry);
  
  // 4. Load core extraction programs
  await loadCoreExtractionPrograms(store);
  
  // 5. Start queue processing
  queueRunner.start();
  
  // 6. Schedule periodic tasks
  schedulePeriodicTasks(queue);
  
  return {
    store,
    queue,
    queueRunner,
    extractionPipeline,
    chainManager,
    memorySystem,
    goalSystem,
    observerDispatcher,
    extensionRegistry,
    synthesizer,
    
    // Main API
    async ingest(text: string, source: 'speech' | 'text'): Promise<string> {
      const unitId = await createConversationUnit(store, text, source);
      await queue.enqueue({
        type: 'extract_from_unit',
        payload: { unitId },
        priority: 10,
        maxAttempts: 3,
        executeAt: Date.now()
      });
      return unitId;
    },
    
    async query(question: string): Promise<QueryResult> {
      return await agenticSearch(question, store, synthesizer);
    },
    
    async getTopOfMind(): Promise<TopOfMind> {
      return await attentionSystem.getTopOfMind();
    },
    
    async getGoalTree(): Promise<GoalTree> {
      return await goalSystem.buildTree();
    },
    
    async runSynthesis(type: string, params: any): Promise<any> {
      return await synthesizer.generate(type, params);
    }
  };
}
```

### Periodic Tasks

```typescript
function schedulePeriodicTasks(queue: DurableQueue): void {
  // Daily: Decay claims
  setInterval(async () => {
    await queue.enqueue({
      type: 'decay_claims',
      payload: {},
      priority: 1,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 24 * 60 * 60 * 1000);
  
  // Weekly: Narrative analysis
  setInterval(async () => {
    await queue.enqueue({
      type: 'run_observer',
      payload: {
        observerId: 'observer_narrative',
        context: { trigger: { type: 'schedule', pattern: 'weekly' } }
      },
      priority: 2,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 7 * 24 * 60 * 60 * 1000);
  
  // Weekly: Mind model synthesis
  setInterval(async () => {
    await queue.enqueue({
      type: 'run_observer',
      payload: {
        observerId: 'observer_mind_model',
        context: { trigger: { type: 'schedule', pattern: 'weekly' } }
      },
      priority: 2,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 7 * 24 * 60 * 60 * 1000);
}
```

### Key Design Decisions Summary (Revised)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IndexedDB + TinyBase | ✓ | Browser-native, no server needed |
| Extension system | ✓ | Composable, verifiable, evolvable |
| Token budget manager | ✓ | Controls LLM costs, prioritizes important context |
| 20 core extractors | ✓ | Comprehensive coverage of mental life |
| Durable queue | ✓ | Reliability without external dependencies |
| Observer pattern | ✓ | Decoupled, asynchronous intelligence |
| Goal tree with hierarchy | ✓ | Captures motivation structure |
| Automatic chain management | ✓ | No manual organization needed |
| Mind model synthesis | ✓ | Holistic understanding beyond individual claims |
| Attention/salience system | ✓ | Tracks what matters now |

---

