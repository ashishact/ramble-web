# Factual Claim Extraction

## Overview

Extracts factual claims - statements about how things are or were.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "The meeting is scheduled for 3 PM tomorrow",
    "subject": "meeting schedule",
    "claim_type": "factual",
    "confidence_expressed": 0.95,
    "verifiability": "easily",
    "temporality": "point_in_time",
    "specificity": "precise"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Entity](./entity.md)
- Next: [Belief](./claim-belief.md)
