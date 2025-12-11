# Entity Extraction

## Overview

Extracts named entities from conversational text: people, organizations, places, products, projects, roles, events, and concepts.

## Configuration

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

## Output Example

```json
[
  {
    "canonical_name": "John Smith",
    "entity_type": "person",
    "aliases": ["John", "JS"],
    "context": "Manager at Acme Corp",
    "relationship_to_speaker": "boss"
  },
  {
    "canonical_name": "Acme Corporation",
    "entity_type": "organization",
    "aliases": ["Acme", "Acme Corp"],
    "context": "Technology company",
    "relationship_to_speaker": "employer"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Next: [Factual Claim](./claim-factual.md)
