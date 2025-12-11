# Relationship Extraction

## Overview

Extracts relationship information - interpersonal connections and dynamics.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "My relationship with my sister has been strained since our argument last year",
    "person": "sister",
    "relationship_type": "family",
    "specific_role": "sibling",
    "quality": "strained",
    "closeness": 0.4,
    "trust_level": 0.5,
    "dynamics": "tension from past conflict",
    "history": "argument last year",
    "current_status": "strained"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Value](./value.md)
- Next: [Self-Perception](./self-perception.md)
