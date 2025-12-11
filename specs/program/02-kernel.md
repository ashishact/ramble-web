# Layer 2: Extensible Kernel Architecture

## Core Kernel

The kernel is minimal and handles only:

1. **Data persistence** (TinyBase ↔ IndexedDB)
2. **Task queue management** (durable execution)
3. **Extension loading and execution**
4. **Token budget management**
5. **LLM interface**

```typescript
// kernel.ts - The minimal core

interface Kernel {
  // Store
  store: TinyBaseStore;

  // Extension registry
  extensions: ExtensionRegistry;

  // Queue
  queue: DurableQueue;

  // LLM
  llm: LLMInterface;

  // Core operations
  ingest(text: string, source: 'speech' | 'text'): Promise<string>; // Returns unit ID
  process(unitId: string): Promise<void>; // Run extraction pipeline
  query(question: string): Promise<QueryResult>;

  // Extension management
  registerExtension(ext: Extension): void;
  executeExtension(id: string, context: ExtensionContext): Promise<any>;
}

interface Extension {
  id: string;
  type: 'extractor' | 'view_synthesizer' | 'observer';
  name: string;

  // Status
  status: 'draft' | 'verified' | 'production';

  // For extractors
  patterns?: Pattern[];
  relevanceScorer?: (match: Match, context: Context) => number;

  // For all types
  systemPrompt: string;
  userPromptTemplate: string; // Contains {VARIABLE} placeholders
  variablesSchema: JSONSchema;
  outputSchema: JSONSchema;

  // Hooks
  beforeExecute?: (context: ExtensionContext) => Promise<ExtensionContext>;
  afterExecute?: (result: any, context: ExtensionContext) => Promise<any>;
}
```

## Extension Format (Stored in DB)

```typescript
interface StoredExtension {
  id: string;
  extension_type: 'view_synthesizer' | 'extractor' | 'observer';
  name: string;
  description: string;

  config_json: string; // Parsed to:
  // {
  //   priority: number,
  //   tokenBudget: number,
  //   patterns: Pattern[],
  //   relevanceScorerCode: string, // Safe eval or predefined scorers
  // }

  system_prompt: string;
  // Example: "You are analyzing a person's beliefs about their career..."

  user_prompt_template: string;
  // Example: "Given the following statements about {TOPIC}:\n\n{STATEMENTS}\n\nExtract..."

  variables_schema_json: string;
  // {
  //   "TOPIC": { "type": "string", "source": "input" },
  //   "STATEMENTS": { "type": "array", "source": "program_output" }
  // }

  output_schema_json: string;
  // JSON Schema for the expected output

  status: 'draft' | 'verified' | 'production';
  version: number;
  created_at: number;
  verified_at: number | null;
}
```

## Extension Examples

### View Synthesizer Extension: "Weekly Reflection"

```json
{
  "id": "view_weekly_reflection",
  "extension_type": "view_synthesizer",
  "name": "Weekly Reflection",
  "description": "Generates a reflection summary of the past week",

  "config_json": {
    "priority": 5,
    "tokenBudget": 4000,
    "triggerCondition": "manual_or_scheduled",
    "schedulePattern": "weekly"
  },

  "system_prompt": "You are helping someone reflect on their week. Be warm, insightful, and constructive. Focus on growth, patterns, and gentle observations.",

  "user_prompt_template": "Here are the key thoughts and events from the past week:\n\n{WEEKLY_CLAIMS}\n\nGoals that were active:\n{ACTIVE_GOALS}\n\nEmotional moments:\n{EMOTIONAL_MARKERS}\n\nPlease provide:\n1. A brief narrative summary of the week\n2. Key themes that emerged\n3. Progress made on goals\n4. One gentle observation or insight\n5. A question for reflection",

  "variables_schema_json": {
    "WEEKLY_CLAIMS": {
      "type": "array",
      "source": "query",
      "query": {
        "table": "claims",
        "filter": { "created_at": { "$gte": "{WEEK_START}" } },
        "orderBy": "created_at",
        "limit": 50
      }
    },
    "ACTIVE_GOALS": {
      "type": "array",
      "source": "query",
      "query": {
        "table": "goals",
        "filter": { "status": "active" }
      }
    },
    "EMOTIONAL_MARKERS": {
      "type": "array",
      "source": "query",
      "query": {
        "table": "claims",
        "filter": {
          "created_at": { "$gte": "{WEEK_START}" },
          "emotional_intensity": { "$gte": 0.5 }
        }
      }
    }
  },

  "output_schema_json": {
    "type": "object",
    "properties": {
      "narrative": { "type": "string" },
      "themes": { "type": "array", "items": { "type": "string" } },
      "goal_progress": { "type": "array" },
      "insight": { "type": "string" },
      "reflection_question": { "type": "string" }
    }
  },

  "status": "production",
  "version": 1
}
```

### Custom Extractor Extension: "Book/Media References"

```json
{
  "id": "extractor_media_references",
  "extension_type": "extractor",
  "name": "Media Reference Extractor",
  "description": "Extracts references to books, movies, podcasts, articles",

  "config_json": {
    "priority": 15,
    "tokenBudget": 1000,
    "patterns": [
      { "type": "keyword", "values": ["reading", "read", "book", "author"] },
      { "type": "keyword", "values": ["watching", "watched", "movie", "show", "series"] },
      { "type": "keyword", "values": ["listening", "podcast", "episode"] },
      { "type": "keyword", "values": ["article", "post", "blog", "tweet"] },
      { "type": "regex", "value": "\"[^\"]+\"" },
      { "type": "regex", "value": "'[^']+'"}
    ],
    "relevanceScorer": "media_reference_scorer"
  },

  "system_prompt": "You extract references to media (books, movies, shows, podcasts, articles) from conversational text. Be precise about titles and include context about why the person mentioned it.",

  "user_prompt_template": "Text to analyze:\n\n{TEXT}\n\nExtract any references to books, movies, TV shows, podcasts, articles, or other media. For each reference include the title, type, and why it was mentioned.",

  "variables_schema_json": {
    "TEXT": { "type": "string", "source": "program_output" }
  },

  "output_schema_json": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "media_type": { "type": "string", "enum": ["book", "movie", "tv_show", "podcast", "article", "other"] },
        "creator": { "type": "string" },
        "context": { "type": "string" },
        "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral", "wanting_to_consume"] }
      }
    }
  },

  "status": "verified",
  "version": 1
}
```

## Verification Workflow

```typescript
// Extension verification workflow

interface VerificationResult {
  passed: boolean;
  testCases: TestCaseResult[];
  notes: string;
}

async function verifyExtension(ext: StoredExtension): Promise<VerificationResult> {
  // 1. Schema validation
  validateSchema(ext.variables_schema_json);
  validateSchema(ext.output_schema_json);

  // 2. Template validation (all variables present)
  validateTemplate(ext.user_prompt_template, ext.variables_schema_json);

  // 3. Run on test cases
  const testCases = getTestCasesForType(ext.extension_type);
  const results = await Promise.all(
    testCases.map(tc => runExtensionOnTestCase(ext, tc))
  );

  // 4. Output validation
  const allValid = results.every(r => validateOutput(r, ext.output_schema_json));

  return {
    passed: allValid,
    testCases: results,
    notes: generateVerificationNotes(results)
  };
}

// Only admin can promote to production
async function promoteToProduction(extId: string, adminKey: string): Promise<void> {
  if (!verifyAdminKey(adminKey)) throw new Error('Unauthorized');

  const ext = await store.getRow('extensions', extId);
  if (ext.status !== 'verified') throw new Error('Must be verified first');

  await store.setRow('extensions', extId, {
    ...ext,
    status: 'production',
    verified_at: Date.now()
  });
}
```

---

## Navigation

- Previous: [01-data-store.md](./01-data-store.md)
- Next: [03-extraction-pipeline.md](./03-extraction-pipeline.md)
