/**
 * Meta Suggestion Observer
 *
 * Uses Gemini 2.5 Flash to:
 * - Suggest new tags and categories
 * - Identify patterns across sessions
 * - Recommend organizational improvements
 *
 * Runs max once per day (on page load)
 */

import { geminiFlash, type Message as ChatMessage } from '../cfGateway';
import {
  observerHelpers,
  type Tag,
  type Category,
  type KnowledgeItem,
} from '../../stores/observerStore';
import { settingsHelpers } from '../../stores/settingsStore';

// Response schema for LLM
interface MetaAnalysisResponse {
  suggestedTags: {
    name: string;
    description: string;
    color: string;
    reason: string;
  }[];
  suggestedCategories: {
    name: string;
    description: string;
    color: string;
    reason: string;
  }[];
  structuralSuggestions: string[];
}

/**
 * Build the system prompt for meta analysis
 */
function buildSystemPrompt(): string {
  return `You are a system analyst helping to organize and improve a knowledge management system.

Your job is to:
1. Suggest new TAGS that would help categorize the knowledge better
2. Suggest new CATEGORIES (can be hierarchical using "/" like "work/projects")
3. Provide STRUCTURAL SUGGESTIONS for improving organization

GUIDELINES:
- Suggest tags/categories that are missing but would be useful
- Don't suggest duplicates of existing ones
- Use descriptive names that are clear and concise
- Provide colors as hex codes (#RRGGBB)
- Limit suggestions to the most impactful ones (max 5 each)
- Structural suggestions should be actionable

Respond ONLY with valid JSON matching this schema:
{
  "suggestedTags": [
    {
      "name": "tag-name",
      "description": "What this tag represents",
      "color": "#3b82f6",
      "reason": "Why this tag would be useful"
    }
  ],
  "suggestedCategories": [
    {
      "name": "category/subcategory",
      "description": "What this category covers",
      "color": "#22c55e",
      "reason": "Why this category would help"
    }
  ],
  "structuralSuggestions": [
    "Consider grouping X with Y because..."
  ]
}`;
}

/**
 * Build the user prompt with system overview
 */
function buildUserPrompt(
  tags: Tag[],
  categories: Category[],
  recentKnowledge: KnowledgeItem[]
): string {
  // Build current tags summary
  const tagsSummary = tags.length > 0
    ? tags.map(t => `- ${t.name}: ${t.description}`).join('\n')
    : 'No tags defined yet';

  // Build current categories summary
  const categoriesSummary = categories.length > 0
    ? categories.map(c => `- ${c.name}: ${c.description}`).join('\n')
    : 'No categories defined yet';

  // Build knowledge summary (sample recent items)
  const knowledgeSample = recentKnowledge
    .flatMap(k => k.contents.map(c => `- [${c.category}] ${c.text.substring(0, 100)}...`))
    .slice(0, 20)
    .join('\n');

  return `Current system structure:

EXISTING TAGS:
${tagsSummary}

EXISTING CATEGORIES:
${categoriesSummary}

RECENT KNOWLEDGE SAMPLES:
${knowledgeSample || 'No knowledge items yet'}

Based on this overview, what structural improvements would you suggest?`;
}

/**
 * Parse the LLM response
 */
function parseResponse(responseText: string): MetaAnalysisResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[MetaObserver] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    parsed.suggestedTags = parsed.suggestedTags || [];
    parsed.suggestedCategories = parsed.suggestedCategories || [];
    parsed.structuralSuggestions = parsed.structuralSuggestions || [];

    return parsed;
  } catch (error) {
    console.error('[MetaObserver] Failed to parse response:', error);
    console.error('[MetaObserver] Raw response:', responseText);
    return null;
  }
}

/**
 * Run meta analysis on the system
 */
export async function runMetaAnalysis(): Promise<void> {
  console.log('[MetaObserver] Running meta analysis...');

  // Get API key
  const apiKey = settingsHelpers.getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  // Get current system structure
  const tags = observerHelpers.getAllTags();
  const categories = observerHelpers.getAllCategories();

  // Get recent knowledge from all sessions
  const sessions = observerHelpers.getAllSessions();
  const recentKnowledge: KnowledgeItem[] = [];

  sessions.slice(0, 5).forEach(session => {
    const items = observerHelpers.getKnowledgeItems(session.id);
    recentKnowledge.push(...items.slice(-10));
  });

  // Skip if not enough data
  if (recentKnowledge.length === 0) {
    console.log('[MetaObserver] Not enough data for meta analysis');
    return;
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(tags, categories, recentKnowledge);

  // Call LLM
  const chatMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  console.log('[MetaObserver] Calling Gemini Flash...');
  const responseText = await geminiFlash.chat(apiKey, chatMessages, systemPrompt);

  // Parse response
  const response = parseResponse(responseText);
  if (!response) {
    console.error('[MetaObserver] Failed to parse response, skipping');
    return;
  }

  console.log('[MetaObserver] Suggested', response.suggestedTags.length, 'tags');
  console.log('[MetaObserver] Suggested', response.suggestedCategories.length, 'categories');
  console.log('[MetaObserver] Made', response.structuralSuggestions.length, 'structural suggestions');

  // Add suggested tags (not committed)
  const now = new Date().toISOString();
  response.suggestedTags.forEach(t => {
    // Check if tag already exists
    if (!tags.some(existing => existing.name === t.name)) {
      observerHelpers.suggestTag({
        name: t.name,
        description: t.description,
        color: t.color,
        icon: 'tag',
        suggested: {
          by: 'ai',
          timestamp: now,
          reason: t.reason,
        },
      });
    }
  });

  // Add suggested categories (not committed)
  response.suggestedCategories.forEach(c => {
    // Check if category already exists
    if (!categories.some(existing => existing.name === c.name)) {
      observerHelpers.suggestCategory({
        name: c.name,
        description: c.description,
        color: c.color,
        icon: 'folder',
        suggested: {
          by: 'ai',
          timestamp: now,
          reason: c.reason,
        },
      });
    }
  });

  // Log structural suggestions (could be shown in UI)
  if (response.structuralSuggestions.length > 0) {
    console.log('[MetaObserver] Structural suggestions:');
    response.structuralSuggestions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s}`);
    });
  }

  console.log('[MetaObserver] Meta analysis completed');
}
