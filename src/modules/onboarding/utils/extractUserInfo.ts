/**
 * Extract User Info from Transcription
 *
 * Uses LLM to parse spoken text and extract structured user information
 */

import { callLLM } from '../../../program/llmClient'
import { parseLLMJSON } from '../../../program/utils/jsonUtils'

export interface ExtractedUserInfo {
  name: string
  aboutMe: string
}

const SYSTEM_PROMPT = `You are extracting user information from spoken text during an onboarding flow.

The user was asked to introduce themselves - say their name and a bit about themselves.

Extract:
1. name: The user's name (first name only, properly capitalized)
2. aboutMe: A clean, well-formatted summary of what they said about themselves (NOT including their name)

Rules:
- Extract the actual name, not phrases like "my name is"
- For aboutMe, clean up filler words and make it a proper sentence/description
- If they mentioned their profession, interests, or background, include that in aboutMe
- Keep aboutMe concise but informative (1-3 sentences)
- If you can't determine the name clearly, use "Friend" as fallback
- If there's nothing meaningful for aboutMe, leave it empty

Respond with JSON only:
{
  "name": "John",
  "aboutMe": "Software developer interested in AI and machine learning."
}`

/**
 * Extract user info from transcribed speech
 */
export async function extractUserInfo(transcription: string): Promise<ExtractedUserInfo> {
  if (!transcription || transcription.trim().length === 0) {
    return { name: '', aboutMe: '' }
  }

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: `Extract user information from this spoken introduction:\n\n"${transcription}"`,
      systemPrompt: SYSTEM_PROMPT,
      options: {
        temperature: 0.3,
        max_tokens: 200,
      },
    })

    const { data, error } = parseLLMJSON(response.content)

    if (error || !data) {
      console.error('[extractUserInfo] Failed to parse LLM response:', error)
      // Fallback: try simple extraction
      return simpleExtraction(transcription)
    }

    const result = data as Record<string, unknown>

    return {
      name: typeof result.name === 'string' ? result.name.trim() : '',
      aboutMe: typeof result.aboutMe === 'string' ? result.aboutMe.trim() : '',
    }
  } catch (error) {
    console.error('[extractUserInfo] LLM call failed:', error)
    // Fallback to simple extraction
    return simpleExtraction(transcription)
  }
}

/**
 * Simple fallback extraction without LLM
 */
function simpleExtraction(text: string): ExtractedUserInfo {
  // Try to extract name using common patterns
  const patterns = [
    /my name is\s+([A-Za-z]+)/i,
    /i'?m\s+([A-Za-z]+)/i,
    /i am\s+([A-Za-z]+)/i,
    /call me\s+([A-Za-z]+)/i,
    /this is\s+([A-Za-z]+)/i,
  ]

  let name = ''
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
      break
    }
  }

  return {
    name,
    aboutMe: text, // Just use raw text as fallback
  }
}
