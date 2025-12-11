# Habit & Routine Extraction

## Overview

Extracts habits and routines from conversational text.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "I've been meditating every morning for the past six months",
    "habit_description": "morning meditation",
    "frequency": "daily",
    "context": "every morning",
    "status": "active",
    "duration": "six months",
    "motivation": "mental clarity",
    "positive_or_negative": "positive"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Preference](./preference.md)
- Next: [Memory Reference](./memory-reference.md)
