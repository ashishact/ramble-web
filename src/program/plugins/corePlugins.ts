/**
 * Core Plugins
 *
 * Default extractors seeded on first run.
 * These are stored in DB and can be modified/disabled.
 */

import { pluginStore } from '../../db/stores';

interface PluginDefinition {
  name: string;
  description: string;
  type: 'extractor' | 'observer' | 'validator';
  triggers?: { patterns?: string[] };
  alwaysRun?: boolean;
  promptTemplate?: string;
  systemPrompt?: string;
  llmTier?: string;
}

// Core plugins to seed
const CORE_PLUGINS: PluginDefinition[] = [
  {
    name: 'correction-detector',
    description: 'Detects STT corrections when user says "I meant X" or "not X, Y"',
    type: 'extractor',
    triggers: {
      patterns: [
        'i meant',
        'i said',
        'not .+,? (but )?',
        'correction',
        'spelled',
        'pronounce',
      ],
    },
    promptTemplate: `Analyze this text for speech-to-text corrections.
Look for patterns like "I meant X", "not X but Y", "it's spelled X".

Input: {{input}}

If corrections found, respond with JSON:
{
  "corrections": [
    {"wrong": "incorrect text", "correct": "correct text"}
  ]
}

If no corrections, respond: {}`,
    llmTier: 'small',
  },
  {
    name: 'emotion-detector',
    description: 'Detects emotional state from input',
    type: 'extractor',
    triggers: {
      patterns: [
        'feel',
        'feeling',
        'happy',
        'sad',
        'angry',
        'frustrated',
        'excited',
        'worried',
        'stressed',
        'anxious',
      ],
    },
    promptTemplate: `Analyze the emotional content of this input.

Input: {{input}}

Respond with JSON:
{
  "emotion": "primary emotion (happy, sad, angry, anxious, excited, neutral, etc.)",
  "intensity": 0.0-1.0,
  "reason": "brief explanation"
}`,
    llmTier: 'small',
  },
  {
    name: 'question-detector',
    description: 'Detects questions and their intent',
    type: 'extractor',
    triggers: {
      patterns: [
        '\\?',
        '^(what|who|where|when|why|how|is|are|can|could|would|should|do|does|did)',
      ],
    },
    promptTemplate: `Analyze this input for questions.

Input: {{input}}

If questions found, respond with JSON:
{
  "questions": [
    {
      "question": "the question text",
      "type": "factual|opinion|rhetorical|clarification",
      "topic": "what the question is about"
    }
  ]
}

If no questions, respond: {}`,
    llmTier: 'small',
  },
];

/**
 * Seed core plugins if they don't exist
 */
export async function seedCorePlugins(): Promise<void> {
  for (const def of CORE_PLUGINS) {
    // Check if already exists
    const existing = await pluginStore.getByName(def.name);
    if (existing) continue;

    // Create plugin
    await pluginStore.create({
      name: def.name,
      description: def.description,
      type: def.type,
      triggers: def.triggers,
      alwaysRun: def.alwaysRun ?? false,
      promptTemplate: def.promptTemplate,
      llmTier: def.llmTier,
      isCore: true,
    });

    console.log(`[Plugins] Seeded core plugin: ${def.name}`);
  }
}
