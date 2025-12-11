/**
 * Entity Extractor
 *
 * Extracts named entities: people, organizations, products, places, projects, roles, events, concepts.
 * Runs first with high priority to identify key entities in the conversation.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedEntity,
} from '../types';

class EntityExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_entity',
    name: 'Entity Extraction',
    description: 'Extracts named entities from conversation',
    claim_types: [], // Primarily produces entities, not claims
    patterns: [
      // Proper nouns
      { id: 'proper_noun', type: 'regex', pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/, weight: 0.8 },
      // Titles
      { id: 'title', type: 'regex', pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+/, weight: 0.9 },
      // Organizations
      { id: 'org', type: 'keyword', pattern: 'Inc|Corp|LLC|Ltd|Company|Team|Group', weight: 0.8 },
      // Roles
      { id: 'role', type: 'keyword', pattern: 'CEO|CTO|manager|director|lead|founder|boss|colleague', weight: 0.6 },
      // Named references
      { id: 'named', type: 'keyword', pattern: 'called|named|known as', weight: 0.9 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.1, max_tokens: 1500 },
    min_confidence: 0.5,
    priority: 100, // Highest priority - runs first
    always_run: true, // Always extract entities
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);

    return `Extract all named entities from the following conversation.

${inputSection}

For each entity found, provide:
- canonical_name: The full/standard name
- entity_type: One of: person, organization, product, place, project, role, event, concept
- aliases: Any nicknames, abbreviations, or alternative names mentioned

Focus on entities that are specific and meaningful - ignore generic words.

Respond with a JSON array:
[
  {
    "canonical_name": "string",
    "entity_type": "person|organization|product|place|project|role|event|concept",
    "aliases": ["string"]
  }
]

If no entities are found, respond with an empty array: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);

    // This extractor primarily produces entities, not claims
    const entities: ExtractedEntity[] = [];

    const validEntityTypes = ['person', 'organization', 'product', 'place', 'project', 'role', 'event', 'concept'] as const;
    type EntityType = typeof validEntityTypes[number];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.canonical_name && obj.entity_type) {
        const rawType = obj.entity_type as string;
        const entityType = validEntityTypes.includes(rawType as EntityType)
          ? (rawType as EntityType)
          : 'concept';

        entities.push({
          canonical_name: obj.canonical_name as string,
          entity_type: entityType,
          aliases: Array.isArray(obj.aliases) ? (obj.aliases as string[]) : [],
        });
      }
    }

    return {
      claims: [],
      entities,
      metadata: {
        model: '',
        tokens_used: 0,
        processing_time_ms: 0,
      },
    };
  }
}

// Register the extractor
const entityExtractor = new EntityExtractor();
registerExtractor(entityExtractor);

export { entityExtractor };
