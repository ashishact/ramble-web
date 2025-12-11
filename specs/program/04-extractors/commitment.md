# Commitment Extraction

## Overview

Extracts commitments - promises and obligations.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "I promised my team I would deliver the report by Friday",
    "commitment": "deliver the report by Friday",
    "to_whom": "team",
    "type": "promise",
    "deadline": "Friday",
    "stakes": "team trust and project timeline",
    "current_status": "in_progress",
    "confidence": 0.85
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Hypothetical](./hypothetical.md)
