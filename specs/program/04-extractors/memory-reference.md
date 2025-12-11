# Memory Reference Extraction

## Overview

Extracts references to past memories and experiences.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "I remember when my grandfather taught me to fish at the lake",
    "memory_summary": "grandfather teaching fishing at a lake",
    "time_period": "childhood",
    "vividness": "vivid",
    "emotional_tone": "nostalgic/warm",
    "significance": "formative bonding experience",
    "people_involved": ["grandfather"],
    "recurring": true
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Habit](./habit.md)
- Next: [Concern](./concern.md)
