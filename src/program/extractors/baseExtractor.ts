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
    if (context.recentClaims.length > 0) {
      const claimsList = context.recentClaims
        .slice(0, 5)
        .map((c) => `- [${c.claimType}] ${c.statement}`)
        .join('\n');
      parts.push(`<recentClaims>\n${claimsList}\n</recentClaims>`);
    }

    // Active chains
    if (context.activeChains.length > 0) {
      const chainsList = context.activeChains.map((c) => `- ${c.topic}`).join('\n');
      parts.push(`<active_topics>\n${chainsList}\n</active_topics>`);
    }

    // Known entities
    if (context.knownEntities.length > 0) {
      const entitiesList = context.knownEntities.slice(0, 10).map((e) => `- ${e.canonicalName} (${e.entityType})`).join('\n');
      parts.push(`<knownEntities>\n${entitiesList}\n</knownEntities>`);
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
      "temporality": "eternal|slowlyDecaying|fastDecaying|pointInTime",
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
        const normalized = normalizeClaim(claim as Record<string, unknown>, config);
        if (normalized && normalized.confidence >= config.minConfidence) {
          claims.push(normalized);
        }
      }
    }

    // Validate and normalize entities
    const entities: ExtractedEntity[] = [];
    if (Array.isArray(parsed.entities)) {
      for (const entity of parsed.entities) {
        const normalized = normalizeEntity(entity as Record<string, unknown>);
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
        tokensUsed: 0, // Will be filled by LLM caller
        processingTimeMs: 0, // Will be filled by LLM caller
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
        tokensUsed: 0,
        processingTimeMs: 0,
      },
    };
  }
}

/**
 * Normalize and validate a claim from LLM output
 * Handles both camelCase and snake_case property names from LLM responses
 */
function normalizeClaim(claim: Record<string, unknown>, config: ExtractorConfig): ExtractedClaim | null {
  // Handle both camelCase and snake_case from LLM response
  const statement = (claim.statement as string | undefined);
  const subject = (claim.subject as string | undefined);
  const rawClaimType = (claim.claimType || claim.claim_type) as string | undefined;
  const rawTemporality = (claim.temporality) as string | undefined;
  const rawAbstraction = (claim.abstraction) as string | undefined;
  const rawSourceType = (claim.sourceType || claim.source_type) as string | undefined;
  const rawStakes = (claim.stakes) as string | undefined;
  const rawConfidence = (claim.confidence) as number | undefined;
  const rawEmotionalValence = (claim.emotionalValence ?? claim.emotional_valence) as number | undefined;
  const rawEmotionalIntensity = (claim.emotionalIntensity ?? claim.emotional_intensity) as number | undefined;
  const rawValidFrom = (claim.validFrom || claim.valid_from) as number | undefined;
  const rawValidUntil = (claim.validUntil || claim.valid_until) as number | undefined;
  const rawElaborates = (claim.elaborates) as string | undefined;

  if (!statement || typeof statement !== 'string') return null;
  if (!subject || typeof subject !== 'string') return null;

  // Validate claim type
  const validClaimTypes = [
    'factual', 'belief', 'intention', 'assessment', 'preference', 'causal',
    'question', 'decision', 'emotion', 'goal', 'value', 'relationship',
    'self_perception', 'habit', 'memory_reference', 'concern', 'learning',
    'change_marker', 'hypothetical', 'commitment',
  ];

  const claimType = rawClaimType && validClaimTypes.includes(rawClaimType)
    ? rawClaimType
    : config.claimTypes[0]; // Default to first claim type of extractor

  // Validate temporality
  const validTemporalities = ['eternal', 'slowlyDecaying', 'fastDecaying', 'pointInTime'];
  const temporality = rawTemporality && validTemporalities.includes(rawTemporality)
    ? rawTemporality
    : 'fastDecaying';

  // Validate abstraction
  const validAbstractions = ['specific', 'general', 'universal'];
  const abstraction = rawAbstraction && validAbstractions.includes(rawAbstraction)
    ? rawAbstraction
    : 'specific';

  // Validate source type
  const validSourceTypes = ['direct', 'inferred', 'corrected'];
  const sourceType = rawSourceType && validSourceTypes.includes(rawSourceType)
    ? rawSourceType
    : 'direct';

  // Validate stakes
  const validStakes = ['low', 'medium', 'high', 'existential'];
  const stakes = rawStakes && validStakes.includes(rawStakes)
    ? rawStakes
    : 'medium';

  // Normalize numbers
  const confidence = typeof rawConfidence === 'number'
    ? Math.max(0, Math.min(1, rawConfidence))
    : 0.7;

  const emotionalValence = typeof rawEmotionalValence === 'number'
    ? Math.max(-1, Math.min(1, rawEmotionalValence))
    : 0;

  const emotionalIntensity = typeof rawEmotionalIntensity === 'number'
    ? Math.max(0, Math.min(1, rawEmotionalIntensity))
    : 0.3;

  return {
    statement: statement.trim(),
    subject: subject.trim(),
    claimType: claimType as ExtractedClaim['claimType'],
    temporality: temporality as ExtractedClaim['temporality'],
    abstraction: abstraction as ExtractedClaim['abstraction'],
    sourceType: sourceType as ExtractedClaim['sourceType'],
    confidence,
    emotionalValence: emotionalValence,
    emotionalIntensity: emotionalIntensity,
    stakes: stakes as ExtractedClaim['stakes'],
    validFrom: rawValidFrom,
    validUntil: rawValidUntil,
    elaborates: rawElaborates,
  };
}

/**
 * Normalize and validate an entity from LLM output
 * Handles both camelCase and snake_case property names from LLM responses
 */
function normalizeEntity(entity: Record<string, unknown>): ExtractedEntity | null {
  // Handle both camelCase and snake_case from LLM response
  const canonicalName = (entity.canonicalName || entity.canonical_name) as string | undefined;
  const rawEntityType = (entity.entityType || entity.entity_type) as string | undefined;
  const aliases = entity.aliases as unknown[] | undefined;

  if (!canonicalName || typeof canonicalName !== 'string') return null;

  const validEntityTypes = ['person', 'organization', 'product', 'place', 'project', 'role', 'event', 'concept'];
  const entityType = rawEntityType && validEntityTypes.includes(rawEntityType)
    ? rawEntityType
    : 'concept';

  return {
    canonicalName: canonicalName.trim(),
    entityType: entityType as ExtractedEntity['entityType'],
    aliases: Array.isArray(aliases)
      ? aliases.filter((a): a is string => typeof a === 'string').map((a) => a.trim())
      : [],
  };
}
