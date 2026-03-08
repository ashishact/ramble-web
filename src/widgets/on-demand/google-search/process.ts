/**
 * Google Search Auto-Detection Process
 *
 * Listens to intermediate transcription, uses small-tier LLM to detect
 * if the conversation warrants a Google search. Returns the search keyword if so.
 */

import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';

const SYSTEM_PROMPT = `You analyze live conversation transcripts to detect if the user (or someone in a meeting) needs external information that can be found via Google search.

Trigger a search when:
- Someone mentions a company, product, person, or concept that needs lookup
- A factual question is asked (stock price, weather, statistics, definitions)
- Someone is clearly unfamiliar with a topic being discussed
- A claim is made that could be verified

Do NOT trigger a search for:
- Casual conversation, greetings, small talk
- Topics already well-covered in the conversation context
- Opinions, feelings, or subjective discussions
- Vague or incomplete sentences that don't form a clear query yet

Respond with JSON only:
{ "search": true, "query": "concise google search query" }
or
{ "search": false }`;

export async function detectSearchNeed(
  currentTranscript: string,
): Promise<{ search: boolean; query?: string }> {
  if (!currentTranscript || currentTranscript.trim().length < 20) {
    return { search: false };
  }

  const wmData = await workingMemory.fetch({ size: 'small' });
  const contextPrompt = workingMemory.formatForLLM({ ...wmData, memories: [] });

  const userPrompt = `## Recent Context
${contextPrompt}

## Live Transcript (latest speech)
${currentTranscript}

Should we Google search something based on this conversation? JSON only.`;

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      category: 'google-search-detect',
      options: {
        temperature: 0.3,
        max_tokens: 150,
      },
    });

    const { data, error } = parseLLMJSON(response.content);
    if (error || !data) return { search: false };

    if (data.search && data.query && typeof data.query === 'string' && data.query.trim().length > 0) {
      return { search: true, query: data.query.trim() };
    }

    return { search: false };
  } catch (err) {
    console.error('[GoogleSearch] Detection failed:', err);
    return { search: false };
  }
}
