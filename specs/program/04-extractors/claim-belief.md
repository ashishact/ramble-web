# Belief Extraction

## Overview

Extracts beliefs and opinions - subjective views about how things are.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "Hard work always pays off eventually",
    "subject": "work ethic",
    "claim_type": "belief",
    "belief_strength": "strong",
    "basis": "experience",
    "openness_to_change": "resistant",
    "domain": "work"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Factual Claim](./claim-factual.md)
- Next: [Intention](./claim-intention.md)
