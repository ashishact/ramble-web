/**
 * Plugin Runner
 *
 * Minimal plugin system:
 * - Load plugins from DB
 * - Match input against triggers (regex)
 * - Run LLM with plugin's prompt template
 * - Return structured output
 */

import { pluginStore, extractionLogStore } from '../../db/stores';
import { callLLM } from '../llmClient';
import type Plugin from '../../db/models/Plugin';
import type { LLMTier } from '../types/llmTiers';

// ============================================================================
// Types
// ============================================================================

export interface PluginOutput {
  pluginId: string;
  pluginName: string;
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  processingTimeMs: number;
}

// ============================================================================
// Plugin Runner
// ============================================================================

/**
 * Run all matching plugins against input text
 */
export async function runPlugins(
  input: string,
  conversationId: string,
  sessionId?: string
): Promise<PluginOutput[]> {
  const results: PluginOutput[] = [];

  // Get active plugins
  const plugins = await pluginStore.getActive();

  for (const plugin of plugins) {
    // Check if plugin should run
    if (!shouldRun(plugin, input)) continue;

    // Run plugin
    const result = await runPlugin(plugin, input, conversationId, sessionId);
    results.push(result);

    // Update plugin stats
    await pluginStore.recordRun(plugin.id, result.success, result.processingTimeMs);
  }

  return results;
}

/**
 * Check if plugin should run on this input
 */
function shouldRun(plugin: Plugin, input: string): boolean {
  // Always run if marked as such
  if (plugin.alwaysRun) return true;

  // Check trigger patterns
  const triggers = plugin.triggersParsed;
  if (triggers.patterns && triggers.patterns.length > 0) {
    for (const pattern of triggers.patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(input)) return true;
      } catch {
        // Invalid regex, skip
      }
    }
  }

  return false;
}

/**
 * Run a single plugin
 */
async function runPlugin(
  plugin: Plugin,
  input: string,
  conversationId: string,
  sessionId?: string
): Promise<PluginOutput> {
  const startTime = Date.now();

  try {
    // Build prompt from template
    const prompt = buildPrompt(plugin, input);

    // Call LLM
    const tier = (plugin.llmTier as LLMTier) || 'small';
    const config = plugin.llmConfigParsed;

    const response = await callLLM({
      tier,
      prompt,
      systemPrompt: plugin.systemPrompt,
      options: {
        temperature: config.temperature ?? 0.3,
        max_tokens: config.maxTokens ?? 500,
      },
    });

    // Parse output
    let output: Record<string, unknown> = {};
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        output = JSON.parse(jsonMatch[0]);
      }
    } catch {
      output = { raw: response.content };
    }

    const processingTimeMs = Date.now() - startTime;

    // Log extraction
    await extractionLogStore.create({
      pluginId: plugin.id,
      conversationId,
      sessionId,
      inputText: input,
      output,
      llmPrompt: prompt,
      llmResponse: response.content,
      llmModel: response.model,
      tokensUsed: response.tokens_used.total,
      processingTimeMs,
      success: true,
    });

    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      success: true,
      output,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Log failure
    await extractionLogStore.create({
      pluginId: plugin.id,
      conversationId,
      sessionId,
      inputText: input,
      output: {},
      processingTimeMs,
      success: false,
      error: errorMessage,
    });

    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      success: false,
      output: {},
      error: errorMessage,
      processingTimeMs,
    };
  }
}

/**
 * Build prompt from plugin template
 */
function buildPrompt(plugin: Plugin, input: string): string {
  if (!plugin.promptTemplate) {
    return `Analyze the following input:\n\n${input}\n\nRespond with JSON.`;
  }

  // Replace {{input}} placeholder
  return plugin.promptTemplate.replace(/\{\{input\}\}/g, input);
}
