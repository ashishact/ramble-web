# Layer 3: Extraction Pipeline

## Pipeline Overview

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

## Program Structure

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

## Token Budget Manager

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

## LLM Extractor Interface

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

## Navigation

- Previous: [02-kernel.md](./02-kernel.md)
- Next: [04-extractors/index.md](./04-extractors/index.md)
