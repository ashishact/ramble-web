/**
 * Relationship Extractor
 *
 * Extracts information about interpersonal relationships from conversation.
 * Relationships connect entities (people) with their dynamics.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class RelationshipExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'relationship_extractor',
    name: 'Relationship Extractor',
    description: 'Extracts relationship information between people',
    claimTypes: ['relationship'],
    patterns: [
      // Family relationships
      { id: 'my_family', type: 'regex', pattern: 'my\\s+(?:wife|husband|partner|mom|dad|mother|father|brother|sister|son|daughter|child|children|parents?|family)', weight: 1.0 },
      { id: 'their_family', type: 'regex', pattern: '(?:his|her|their)\\s+(?:wife|husband|partner|mom|dad|mother|father|brother|sister|son|daughter|child|children|parents?|family)', weight: 0.8 },

      // Professional relationships
      { id: 'my_work', type: 'regex', pattern: 'my\\s+(?:boss|manager|colleague|coworker|team|employee|client|customer)', weight: 0.9 },
      { id: 'work_with', type: 'regex', pattern: '(?:work|working)\\s+with', weight: 0.6 },
      { id: 'reports_to', type: 'regex', pattern: '(?:report|reports)\\s+to', weight: 0.8 },

      // Friendship
      { id: 'my_friend', type: 'regex', pattern: 'my\\s+(?:friend|best\\s+friend|buddy|mate)', weight: 0.9 },
      { id: 'friends_with', type: 'regex', pattern: 'friends\\s+with', weight: 0.8 },

      // Romantic relationships
      { id: 'dating', type: 'keyword', pattern: 'dating', weight: 0.9 },
      { id: 'relationship', type: 'regex', pattern: '(?:in\\s+a\\s+)?relationship\\s+with', weight: 0.9 },
      { id: 'married_to', type: 'regex', pattern: 'married\\s+to', weight: 1.0 },
      { id: 'engaged', type: 'keyword', pattern: 'engaged', weight: 0.9 },

      // Relationship dynamics
      { id: 'get_along', type: 'regex', pattern: "(?:get|getting)\\s+along\\s+(?:with|well)", weight: 0.7 },
      { id: 'fight_with', type: 'regex', pattern: '(?:fight|fighting|argue|arguing)\\s+with', weight: 0.8 },
      { id: 'close_to', type: 'regex', pattern: 'close\\s+(?:to|with)', weight: 0.7 },
      { id: 'trust', type: 'regex', pattern: "(?:trust|don't trust)", weight: 0.8 },

      // Relationship changes
      { id: 'broke_up', type: 'regex', pattern: 'broke\\s+up', weight: 0.9 },
      { id: 'got_together', type: 'regex', pattern: 'got\\s+together', weight: 0.8 },
      { id: 'met', type: 'regex', pattern: '(?:met|meeting)\\s+(?:with)?', weight: 0.5 },
    ],
    llmTier: 'small',
    llmOptions: {
      temperature: 0.3,
      maxTokens: 1000,
    },
    minConfidence: 0.6,
    priority: 75,
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at extracting relationship information from conversation.

RELATIONSHIP claims describe connections between people. Look for:
- Family relationships (spouse, parent, sibling, child)
- Professional relationships (boss, colleague, client)
- Friendships and social connections
- Romantic relationships
- Relationship dynamics (how they get along, conflicts)
- Relationship changes (meeting, breaking up, reconciling)

For each relationship claim:
- Who is the relationship between (include both parties in statement)
- What type of relationship is it
- What is the current state/quality
- Any recent changes or developments

Also extract ENTITIES for the people mentioned.

${contextSection}

${inputSection}

${outputInstructions}

For relationships:
- subject: The primary person in the relationship (often "I" or the speaker)
- statement: Describe the relationship clearly
- temporality: "slowlyDecaying" for ongoing relationships, "pointInTime" for events
- stakes: Based on importance of the relationship`;
  }
}

// Create and register the extractor
const relationshipExtractor = new RelationshipExtractor();
registerExtractor(relationshipExtractor);

export { relationshipExtractor };
