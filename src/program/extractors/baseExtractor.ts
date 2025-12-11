/**
 * Base Extractor
 *
 * Abstract base class for extraction programs.
 * Provides common utilities and default implementations.
 */

import type {
  ExtractionProgram,
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
  ExtractedEntity,
} from './types';

// ============================================================================
// Base Extractor Abstract Class
// ============================================================================

export abstract class BaseExtractor implements ExtractionProgram {
  abstract config: ExtractorConfig;

  /**
   * Build the extraction prompt. Must be implemented by subclasses.
   */
  abstract buildPrompt(context: ExtractorContext): string;

  /**
   * Parse the LLM response. Subclasses can override for custom parsing.
   */
  parseResponse(response: string, context: ExtractorContext): ExtractionResult {
    return parseJSONResponse(response, context, this.config);
  }

  /**
   * Optional post-processing. Subclasses can override.
   */
  postProcess?(claims: ExtractedClaim[], context: ExtractorContext): ExtractedClaim[];

  /**
   * Build the context section of the prompt
   */
  protected buildContextSection(context: ExtractorContext): string {
    const parts: string[] = [];

    // Preceding context
    if (context.unit.precedingContextSummary) {
      parts.push(`<preceding_context>\n${context.unit.precedingContextSummary}\n</preceding_context>`);
    }

    // Recent claims
    if (context.recent_claims.length > 0) {
      const claimsList = context.recent_claims
        .slice(0, 5)
        .map((c) => `- [${c.claim_type}] ${c.statement}`)
        .join('\n');
      parts.push(`<recent_claims>\n${claimsList}\n</recent_claims>`);
    }

    // Active chains
    if (context.active_chains.length > 0) {
      const chainsList = context.active_chains.map((c) => `- ${c.topic}`).join('\n');
      parts.push(`<active_topics>\n${chainsList}\n</active_topics>`);
    }

    // Known entities
    if (context.known_entities.length > 0) {
      const entitiesList = context.known_entities.slice(0, 10).map((e) => `- ${e.canonicalName} (${e.entityType})`).join('\n');
      parts.push(`<known_entities>\n${entitiesList}\n</known_entities>`);
    }

    return parts.join('\n\n');
  }

  /**
   * Build the input text section
   */
  protected buildInputSection(context: ExtractorContext): string {
    const source = context.unit.source === 'speech' ? 'spoken' : 'written';
    return `<input source="${source}">\n${context.unit.sanitizedText}\n</input>`;
  }

  /**
   * Build common output format instructions
   */
  protected buildOutputInstructions(): string {
    return `
Respond with a JSON object in this exact format:
{
  "claims": [
    {
      "statement": "The claim as a clear, standalone statement",
      "subject": "The main entity this claim is about",
      "claim_type": "one of the valid claim types",
      "temporality": "eternal|slowly_decaying|fast_decaying|point_in_time",
      "abstraction": "specific|general|universal",
      "source_type": "direct|inferred|corrected",
      "confidence": 0.0-1.0,
      "emotional_valence": -1.0 to 1.0,
      "emotional_intensity": 0.0-1.0,
      "stakes": "low|medium|high|existential"
    }
  ],
  "entities": [
    {
      "canonical_name": "Entity Name",
      "entity_type": "person|organization|product|place|project|role|event|concept",
      "aliases": ["alt name 1", "alt name 2"]
    }
  ]
}

Only include claims you are confident about. Return an empty claims array if no relevant claims are found.
Do not include any text before or after the JSON object.`;
  }
}

// ============================================================================
// JSON Response Parser
// ============================================================================

/**
 * Simple JSON array parser for extractors that expect array format.
 * Returns the parsed array or empty array on failure.
 */
export function parseSimpleJSONArray(response: string): unknown[] {
  let jsonStr = response.trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find JSON array
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to return empty
    }
  }

  return [];
}

/**
 * Parse a JSON response from the LLM
 */
export function parseJSONResponse(
  response: string,
  _context: ExtractorContext,
  config: ExtractorConfig
): ExtractionResult {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize claims
    const claims: ExtractedClaim[] = [];
    if (Array.isArray(parsed.claims)) {
      for (const claim of parsed.claims) {
        const normalized = normalizeClaim(claim, config);
        if (normalized && normalized.confidence >= config.minConfidence) {
          claims.push(normalized);
        }
      }
    }

    // Validate and normalize entities
    const entities: ExtractedEntity[] = [];
    if (Array.isArray(parsed.entities)) {
      for (const entity of parsed.entities) {
        const normalized = normalizeEntity(entity);
        if (normalized) {
          entities.push(normalized);
        }
      }
    }

    return {
      claims,
      entities,
      metadata: {
        model: config.llmTier, // Tier name as model identifier
        tokens_used: 0, // Will be filled by LLM caller
        processing_time_ms: 0, // Will be filled by LLM caller
      },
    };
  } catch (error) {
    console.error(`[${config.id}] Failed to parse LLM response:`, error);
    console.error('Response was:', response.slice(0, 500));

    return {
      claims: [],
      entities: [],
      metadata: {
        model: config.llmTier, // Tier name as model identifier
        tokens_used: 0,
        processing_time_ms: 0,
      },
    };
  }
}

/**
 * Normalize and validate a claim from LLM output
 */
function normalizeClaim(claim: Partial<ExtractedClaim>, config: ExtractorConfig): ExtractedClaim | null {
  if (!claim.statement || typeof claim.statement !== 'string') return null;
  if (!claim.subject || typeof claim.subject !== 'string') return null;

  // Validate claim type
  const validClaimTypes = [
    'factual', 'belief', 'intention', 'assessment', 'preference', 'causal',
    'question', 'decision', 'emotion', 'goal', 'value', 'relationship',
    'self_perception', 'habit', 'memory_reference', 'concern', 'learning',
    'change_marker', 'hypothetical', 'commitment',
  ];

  const claimType = claim.claim_type && validClaimTypes.includes(claim.claim_type)
    ? claim.claim_type
    : config.claim_types[0]; // Default to first claim type of extractor

  // Validate temporality
  const validTemporalities = ['eternal', 'slowly_decaying', 'fast_decaying', 'point_in_time'];
  const temporality = claim.temporality && validTemporalities.includes(claim.temporality)
    ? claim.temporality
    : 'fast_decaying';

  // Validate abstraction
  const validAbstractions = ['specific', 'general', 'universal'];
  const abstraction = claim.abstraction && validAbstractions.includes(claim.abstraction)
    ? claim.abstraction
    : 'specific';

  // Validate source type
  const validSourceTypes = ['direct', 'inferred', 'corrected'];
  const sourceType = claim.sourceType && validSourceTypes.includes(claim.sourceType)
    ? claim.sourceType
    : 'direct';

  // Validate stakes
  const validStakes = ['low', 'medium', 'high', 'existential'];
  const stakes = claim.stakes && validStakes.includes(claim.stakes)
    ? claim.stakes
    : 'medium';

  // Normalize numbers
  const confidence = typeof claim.confidence === 'number'
    ? Math.max(0, Math.min(1, claim.confidence))
    : 0.7;

  const emotionalValence = typeof claim.emotionalValence === 'number'
    ? Math.max(-1, Math.min(1, claim.emotionalValence))
    : 0;

  const emotionalIntensity = typeof claim.emotionalIntensity === 'number'
    ? Math.max(0, Math.min(1, claim.emotionalIntensity))
    : 0.3;

  return {
    statement: claim.statement.trim(),
    subject: claim.subject.trim(),
    claim_type: claimType as ExtractedClaim['claim_type'],
    temporality: temporality as ExtractedClaim['temporality'],
    abstraction: abstraction as ExtractedClaim['abstraction'],
    source_type: sourceType as ExtractedClaim['source_type'],
    confidence,
    emotional_valence: emotionalValence,
    emotional_intensity: emotionalIntensity,
    stakes: stakes as ExtractedClaim['stakes'],
    valid_from: claim.validFrom,
    valid_until: claim.validUntil,
    elaborates: claim.elaborates,
  };
}

/**
 * Normalize and validate an entity from LLM output
 */
function normalizeEntity(entity: Partial<ExtractedEntity>): ExtractedEntity | null {
  if (!entity.canonicalName || typeof entity.canonicalName !== 'string') return null;

  const validEntityTypes = ['person', 'organization', 'product', 'place', 'project', 'role', 'event', 'concept'];
  const entityType = entity.entityType && validEntityTypes.includes(entity.entityType)
    ? entity.entityType
    : 'concept';

  return {
    canonical_name: entity.canonicalName.trim(),
    entity_type: entityType as ExtractedEntity['entity_type'],
    aliases: Array.isArray(entity.aliases)
      ? entity.aliases.filter((a): a is string => typeof a === 'string').map((a) => a.trim())
      : [],
  };
}
