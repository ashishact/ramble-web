/**
 * System 2 Thinker
 *
 * Uses Gemini 2.5 Flash for deep analysis:
 * - Runs every 16 knowledge items
 * - Runs on session resume with pending items
 * - Consolidates knowledge and extracts goals/plans/errors
 * - Can correct knowledge items and state
 */

import { geminiFlash, type Message as ChatMessage } from '../cfGateway';
import {
  observerHelpers,
  type KnowledgeItem,
  type SystemThinking,
} from '../../stores/observerStore';
import { settingsHelpers } from '../../stores/settingsStore';

// Response schema for LLM
interface System2Response {
  systemThinking: {
    summary: string;
    goals: string[];
    errors: string[];
    plan: string[];
  };
  stateCorrections?: Record<string, unknown>;
  knowledgeCorrections?: {
    id: string;
    updates: {
      contents?: {
        text: string;
        category: string;
        tags: string[];
        privacy: string[];
      }[];
    };
  }[];
}

/**
 * Build the system prompt for deep analysis
 */
function buildSystemPrompt(): string {
  return `You are a deep analytical system that consolidates and synthesizes knowledge.

Your job is to:
1. SUMMARIZE: Create a concise summary of what the user is working on or thinking about
2. GOALS: Identify explicit and implicit goals from the conversation
3. PLAN: Suggest logical next steps or action items
4. ERRORS: Note any errors, contradictions, or unsuccessful attempts
5. CORRECTIONS: Suggest corrections to the session state or knowledge items if needed

Be thorough but concise. Focus on the big picture and what matters most.

Respond ONLY with valid JSON matching this schema:
{
  "systemThinking": {
    "summary": "A 2-3 sentence summary of the current focus",
    "goals": ["Goal 1", "Goal 2"],
    "errors": ["Error or issue noted"],
    "plan": ["Step 1", "Step 2"]
  },
  "stateCorrections": {
    "key": "corrected value (only if needed)"
  },
  "knowledgeCorrections": [
    {
      "id": "knowledge-item-id",
      "updates": {
        "contents": [{ "text": "corrected text", "category": "...", "tags": [], "privacy": [] }]
      }
    }
  ]
}

Only include stateCorrections and knowledgeCorrections if there are actual errors to fix.`;
}

/**
 * Build the user prompt with full context
 */
function buildUserPrompt(
  knowledgeItems: KnowledgeItem[],
  currentState: Record<string, unknown>,
  existingThinking: SystemThinking
): string {
  // Build knowledge summary
  const knowledgeSummary = knowledgeItems
    .map((k, i) => {
      const contents = k.contents
        .map(c => `  - [${c.category}] ${c.text} (tags: ${c.tags.join(', ') || 'none'})`)
        .join('\n');
      return `Item ${i + 1} (id: ${k.id}):\n${contents}`;
    })
    .join('\n\n');

  // Build existing thinking summary
  const existingThinkingSummary = existingThinking.summary
    ? `Previous summary: ${existingThinking.summary}
Previous goals: ${existingThinking.goals.join(', ') || 'none'}
Previous plan: ${existingThinking.plan.join(' → ') || 'none'}
Previous errors: ${existingThinking.errors.join(', ') || 'none'}`
    : 'No previous analysis';

  return `Session state:
${JSON.stringify(currentState, null, 2)}

Previous analysis:
${existingThinkingSummary}

Knowledge items to analyze (last ${knowledgeItems.length}):
${knowledgeSummary}

Please provide an updated deep analysis of this session.`;
}

/**
 * Parse the LLM response
 */
function parseResponse(responseText: string): System2Response | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[System2Thinker] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!parsed.systemThinking) {
      parsed.systemThinking = { summary: '', goals: [], errors: [], plan: [] };
    }

    // Ensure arrays
    parsed.systemThinking.goals = parsed.systemThinking.goals || [];
    parsed.systemThinking.errors = parsed.systemThinking.errors || [];
    parsed.systemThinking.plan = parsed.systemThinking.plan || [];

    return parsed;
  } catch (error) {
    console.error('[System2Thinker] Failed to parse response:', error);
    console.error('[System2Thinker] Raw response:', responseText);
    return null;
  }
}

/**
 * Run deep analysis on a session
 */
export async function runDeepAnalysis(
  sessionId: string,
  itemCount = 16
): Promise<void> {
  console.log('[System2Thinker] Running deep analysis for session:', sessionId);

  // Get API key
  const apiKey = settingsHelpers.getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  // Get session data
  const session = observerHelpers.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Get recent knowledge items
  const allKnowledge = observerHelpers.getKnowledgeItems(sessionId);
  const knowledgeItems = allKnowledge.slice(-itemCount);

  if (knowledgeItems.length === 0) {
    console.log('[System2Thinker] No knowledge items to analyze, skipping');
    return;
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(
    knowledgeItems,
    session.state,
    session.systemThinking
  );

  // Call LLM
  const chatMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  console.log('[System2Thinker] Calling Gemini Flash...');
  const responseText = await geminiFlash.chat(apiKey, chatMessages, systemPrompt);

  // Parse response
  const response = parseResponse(responseText);
  if (!response) {
    console.error('[System2Thinker] Failed to parse response, skipping');
    return;
  }

  console.log('[System2Thinker] Analysis complete');
  console.log('[System2Thinker] Summary:', response.systemThinking.summary);
  console.log('[System2Thinker] Goals:', response.systemThinking.goals);

  // Update system thinking
  observerHelpers.updateSystemThinking(sessionId, response.systemThinking);

  // Apply state corrections if any
  if (response.stateCorrections && Object.keys(response.stateCorrections).length > 0) {
    console.log('[System2Thinker] Applying', Object.keys(response.stateCorrections).length, 'state corrections');
    observerHelpers.updateSessionState(sessionId, response.stateCorrections);
  }

  // Apply knowledge corrections if any
  if (response.knowledgeCorrections && response.knowledgeCorrections.length > 0) {
    console.log('[System2Thinker] Applying', response.knowledgeCorrections.length, 'knowledge corrections');
    response.knowledgeCorrections.forEach(correction => {
      if (correction.updates.contents) {
        observerHelpers.updateKnowledgeItem(correction.id, {
          contents: correction.updates.contents,
        });
      }
    });
  }

  console.log('[System2Thinker] Completed for session:', sessionId);
}

/**
 * Check if analysis is needed for a session
 * Used when resuming a session
 */
export async function checkAndRunIfNeeded(sessionId: string): Promise<void> {
  const knowledgeCount = observerHelpers.getKnowledgeItemCount(sessionId);
  const session = observerHelpers.getSession(sessionId);

  if (!session) return;

  // If we have knowledge but no summary, run analysis
  if (knowledgeCount > 0 && !session.systemThinking.summary) {
    console.log('[System2Thinker] Session needs analysis on resume');
    await runDeepAnalysis(sessionId, knowledgeCount);
  }
}
