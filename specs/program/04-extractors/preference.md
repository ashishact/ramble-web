# Preference Extraction

## Overview

Extracts preferences - likes, dislikes, and preferred choices.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "I prefer working from home over being in the office",
    "preference": "working from home over office",
    "preference_type": "preference_between",
    "domain": "work",
    "intensity": 0.8,
    "reasoning": "fewer distractions",
    "context_dependent": false
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Self-Perception](./self-perception.md)
- Next: [Habit](./habit.md)
