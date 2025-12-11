# Emotional State Extraction

## Overview

Extracts emotional states and feelings from conversational text.

## Configuration

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

## Output Example

```json
[
  {
    "statement": "I've been feeling really anxious about the presentation next week",
    "primary_emotion": "fear",
    "nuanced_emotion": "anxious",
    "valence": -0.6,
    "intensity": 0.7,
    "trigger": "upcoming presentation",
    "subject": "self",
    "temporality": "ongoing",
    "physical_manifestations": null,
    "coping_mentioned": null
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Decision](./decision.md)
- Next: [Goal](./goal.md)
