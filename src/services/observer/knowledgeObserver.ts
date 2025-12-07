/**
 * Knowledge Observer (1st Observer)
 *
 * Uses Gemini 2.5 Flash to:
 * - Extract complete sentences from messages
 * - Correct spelling/pronunciation errors
 * - Identify entities (people, places, concepts)
 * - Assign category and tags (from committed only)
 * - Update session state with key facts
 */

import { jsonrepair } from 'jsonrepair';
import { geminiFlash, type Message as ChatMessage } from '../cfGateway';
import {
  observerHelpers,
  type Message,
  type KnowledgeContent,
} from '../../stores/observerStore';
import { settingsHelpers } from '../../stores/settingsStore';
import { checkSystem2Trigger } from './observerQueue';

// Response schema for LLM
interface KnowledgeExtractionResponse {
  sentences: {
    text: string;
    category: string;
    tags: string[];
    privacy: string[];
  }[];
  entities: {
    name: string;
    type: string;
  }[];
  stateUpdates: Record<string, unknown>;
  processedText?: string; // Cleaned version of raw text
}

/**
 * Build the system prompt for knowledge extraction
 */
function buildSystemPrompt(
  committedCategories: string[],
  committedTags: string[],
  privacyScopes: string[]
): string {
  return `You are a knowledge extraction assistant. Your job is to analyze user speech/text and extract structured knowledge.

RULES:
1. Extract complete, self-contained sentences that capture key information
2. Each sentence should be a single thought or fact
3. Correct obvious spelling/pronunciation errors in the processed text
4. Identify named entities (people, places, organizations, concepts)
5. Assign ONE category per sentence from the available list
6. Assign relevant tags from the available list (can be multiple)
7. Assign privacy scope(s) based on content sensitivity
8. Update state with key facts, goals, and context

AVAILABLE CATEGORIES: ${JSON.stringify(committedCategories)}
AVAILABLE TAGS: ${JSON.stringify(committedTags)}
PRIVACY SCOPES: ${JSON.stringify(privacyScopes)}

If no tags fit, use an empty array.
If category doesn't fit, use "general".

Respond ONLY with valid JSON matching this schema:
{
  "sentences": [
    {
      "text": "Complete sentence capturing a key piece of information",
      "category": "category-name",
      "tags": ["tag1", "tag2"],
      "privacy": ["private"]
    }
  ],
  "entities": [
    { "name": "Entity Name", "type": "person|place|organization|concept|event|other" }
  ],
  "stateUpdates": {
    "key": "value pairs to add/update in session state"
  },
  "processedText": "Cleaned version of the raw input text with corrections"
}`;
}

/**
 * Build the user prompt with context
 */
function buildUserPrompt(
  messages: Message[],
  currentState: Record<string, unknown>
): string {
  const messagesText = messages
    .map(m => `[${m.role}]: ${m.raw}`)
    .join('\n');

  return `Current session state:
${JSON.stringify(currentState, null, 2)}

New messages to process:
${messagesText}

Extract knowledge from these messages.`;
}

/**
 * Parse the LLM response with JSON repair fallback
 * @throws Error if JSON cannot be parsed or repaired
 */
function parseResponse(responseText: string): KnowledgeExtractionResponse {
  // Try to extract JSON from the response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[KnowledgeObserver] No JSON found in response');
    throw new Error('No JSON found in LLM response');
  }

  let parsed: KnowledgeExtractionResponse;
  const jsonStr = jsonMatch[0];

  // First try normal parsing
  try {
    parsed = JSON.parse(jsonStr);
    console.log('[KnowledgeObserver] JSON parsed successfully');
  } catch (parseError) {
    // Try to repair the JSON
    console.warn('[KnowledgeObserver] JSON parse failed, attempting repair...');
    console.warn('[KnowledgeObserver] Parse error:', parseError);

    try {
      const repairedJson = jsonrepair(jsonStr);
      parsed = JSON.parse(repairedJson);
      console.log('[KnowledgeObserver] JSON repaired successfully');
    } catch (repairError) {
      console.error('[KnowledgeObserver] JSON repair failed:', repairError);
      console.error('[KnowledgeObserver] Raw response:', responseText);
      throw new Error(`Failed to parse or repair JSON: ${repairError}`);
    }
  }

  // Validate and normalize structure
  if (!Array.isArray(parsed.sentences)) {
    parsed.sentences = [];
  }
  if (!Array.isArray(parsed.entities)) {
    parsed.entities = [];
  }
  if (typeof parsed.stateUpdates !== 'object' || parsed.stateUpdates === null) {
    parsed.stateUpdates = {};
  }

  return parsed;
}

/**
 * Process messages and extract knowledge
 */
export async function processMessages(
  sessionId: string,
  messageIds: string[]
): Promise<void> {
  console.log('[KnowledgeObserver] Processing', messageIds.length, 'messages for session:', sessionId);

  // Get API key
  const apiKey = settingsHelpers.getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  // Get session and messages
  const session = observerHelpers.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Get the messages to process
  const allMessages = observerHelpers.getMessages(sessionId);
  const messagesToProcess = allMessages.filter(m => messageIds.includes(m.id));

  if (messagesToProcess.length === 0) {
    console.log('[KnowledgeObserver] No messages to process');
    return;
  }

  // Get committed categories, tags, and privacy
  const categories = observerHelpers.getCommittedCategories().map(c => c.name);
  const tags = observerHelpers.getCommittedTags().map(t => t.name);
  const privacy = observerHelpers.getAllPrivacy().map(p => p.name);

  // Build prompts
  const systemPrompt = buildSystemPrompt(categories, tags, privacy);
  const userPrompt = buildUserPrompt(messagesToProcess, session.state);

  // Call LLM
  const chatMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  console.log('[KnowledgeObserver] Calling Gemini Flash...');
  const responseText = await geminiFlash.chat(apiKey, chatMessages, systemPrompt);

  // Parse response (will throw on failure)
  const response = parseResponse(responseText);

  console.log('[KnowledgeObserver] Extracted', response.sentences.length, 'sentences');

  // Create knowledge item if we have sentences
  if (response.sentences.length > 0) {
    const contents: KnowledgeContent[] = response.sentences.map(s => ({
      text: s.text,
      category: categories.includes(s.category) ? s.category : 'general',
      tags: s.tags.filter(t => tags.includes(t)),
      privacy: s.privacy.filter(p => privacy.includes(p)),
    }));

    const entityNames = response.entities.map(e => e.name);

    observerHelpers.addKnowledgeItem(sessionId, contents, entityNames);

    // Add entities to the global entity list
    response.entities.forEach(entity => {
      observerHelpers.addOrUpdateEntity(entity.name, entity.type, sessionId);
    });
  }

  // Update session state
  if (Object.keys(response.stateUpdates).length > 0) {
    observerHelpers.updateSessionState(sessionId, response.stateUpdates);
    console.log('[KnowledgeObserver] Updated session state with', Object.keys(response.stateUpdates).length, 'keys');
  }

  // Check if System 2 Thinker should run
  await checkSystem2Trigger(sessionId);

  console.log('[KnowledgeObserver] Completed processing for session:', sessionId);
}

/**
 * Process a single message (convenience function)
 */
export async function processMessage(
  sessionId: string,
  messageId: string
): Promise<void> {
  return processMessages(sessionId, [messageId]);
}
