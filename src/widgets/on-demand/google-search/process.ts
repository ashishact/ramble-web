/**
 * Google Search Auto-Detection Process
 *
 * Listens to intermediate transcription, uses small-tier LLM to decide
 * if the conversation warrants a Google search, AND always provides
 * the LLM's own answer to whatever is being discussed.
 */

import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';

const SYSTEM_PROMPT = `You analyze live conversation transcripts. You have two jobs:

1. ALWAYS answer the question or topic being discussed using your own knowledge.
2. Decide if a Google search is ALSO needed — searches should be RARE.

You are an LLM with broad knowledge. If the topic is something you can answer (history, science, math, general facts, common knowledge), just answer it. Do NOT search.

ONLY trigger a search for:
- A specific person's name that is not universally famous (e.g. a CEO, researcher, local figure — NOT "Einstein" or "Elon Musk")
- A specific company or startup name that needs lookup (e.g. "Anduril", "Cohere" — NOT "Apple" or "Google")
- A niche technical term, concept, or acronym the user seems unfamiliar with
- A specific place, venue, or location that is not common knowledge
- Current weather for a specific city (query: "<city> weather")
- Current stock price of a company (query: "<company> stock price")

Do NOT search for:
- General knowledge questions (history, science, geography, definitions, "when was WW2", etc.)
- Anything you as an LLM can answer well
- Casual conversation, greetings, opinions, small talk
- Topics already covered in the conversation context
- Vague or incomplete sentences
- Famous people, major companies, well-known places
- How-to questions, explanations, comparisons

The search query (if any) MUST be 1-5 words — a specific name, term, or concept. Not a full question.

Respond with JSON only. Three possible responses:

1. Nothing interesting — no question, just casual talk or incomplete sentences:
{ "search": false }

2. A question/topic you can answer from your knowledge (most common case):
{ "search": false, "llm": { "question": "the question being discussed", "answer": "your concise answer" } }

3. A question/topic that ALSO needs a Google search for a specific uncommon term:
{ "search": true, "query": "specific term", "llm": { "question": "the question", "answer": "your best answer" } }

Only include the "llm" object when there is a clear question or topic worth answering. Do NOT answer casual talk, greetings, small talk, or incomplete sentences.`;

export interface DetectionResult {
  search: boolean;
  query?: string;
  llm?: {
    question: string;
    answer: string;
  };
}

export async function detectSearchNeed(
  currentTranscript: string,
): Promise<DetectionResult> {
  if (!currentTranscript || currentTranscript.trim().length < 20) {
    return { search: false };
  }

  const wmData = await workingMemory.fetch({ size: 'small' });
  const contextPrompt = workingMemory.formatForLLM({ ...wmData, memories: [] });

  const userPrompt = `## Recent Context
${contextPrompt}

## Live Transcript (latest speech)
${currentTranscript}

Analyze the conversation. Answer the topic being discussed and decide if Google search is also needed. JSON only.`;

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      category: 'google-search-detect',
      options: {
        temperature: 0.3,
        max_tokens: 400,
      },
    });

    const { data, error } = parseLLMJSON(response.content) as { data: any; error: any };
    if (error || !data) return { search: false };

    const llm = data.llm && typeof data.llm === 'object' && data.llm.question && data.llm.answer
      ? { question: String(data.llm.question), answer: String(data.llm.answer) }
      : undefined;

    if (data.search && data.query && typeof data.query === 'string' && data.query.trim().length > 0) {
      return { search: true, query: data.query.trim(), llm };
    }

    return { search: false, llm };
  } catch (err) {
    console.error('[GoogleSearch] Detection failed:', err);
    return { search: false };
  }
}
