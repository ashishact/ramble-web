/**
 * Speak Better Widget
 *
 * Helps users improve their speech by analyzing what they said
 * and suggesting better ways to express it.
 *
 * Observes the conversations table and triggers analysis
 * when a new user message is created.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Q } from "@nozbe/watermelondb";
import { database } from "../../../db/database";
import type Conversation from "../../../db/models/Conversation";
import { eventBus } from "../../../lib/eventBus";
import { useWidgetPause } from "../useWidgetPause";
import {
  analyzeText,
  loadFromStorage,
  loadTone,
  saveTone,
  TONES,
  type ToneId,
  type AnalysisResult,
  type Suggestion,
} from "./process";
import {
  Sparkles,
  RefreshCw,
  AlertCircle,
  BookOpen,
  Lightbulb,
  Settings,
  type LucideIcon,
} from "lucide-react";

type LoadingState = "idle" | "loading" | "success" | "error";

// Category icons
const categoryIcons: Record<Suggestion["category"], LucideIcon> = {
  vocabulary: BookOpen,
  conciseness: Sparkles,
  clarity: Lightbulb,
  tone: Sparkles,
  grammar: Sparkles,
};

// Category colors (for background highlights)
const categoryBgColors: Record<Suggestion["category"], string> = {
  vocabulary: "bg-purple-500/20",
  conciseness: "bg-blue-500/20",
  clarity: "bg-amber-500/20",
  tone: "bg-green-500/20",
  grammar: "bg-red-500/20",
};

// Category labels
const categoryLabels: Record<Suggestion["category"], string> = {
  vocabulary: "Vocabulary",
  conciseness: "Conciseness",
  clarity: "Clarity",
  tone: "Tone",
  grammar: "Grammar",
};

// Category border colors for suggestion cards
const categoryBorderColors: Record<Suggestion["category"], string> = {
  vocabulary: "border-l-purple-500",
  conciseness: "border-l-blue-500",
  clarity: "border-l-amber-500",
  tone: "border-l-green-500",
  grammar: "border-l-red-500",
};

/**
 * Parse "first two ... last two" format and find the phrase in betterVersion
 * Returns { start, end } indices or null if not found
 */
function findPhraseInText(
  improved: string,
  betterVersion: string,
): { start: number; end: number } | null {
  if (!improved || !betterVersion) return null;

  // Parse "first second ... second-last last" format
  const match = improved.match(/^(.+?)\s*\.\.\.\s*(.+)$/);
  if (!match) return null;

  const startWords = match[1].trim().toLowerCase();
  const endWords = match[2].trim().toLowerCase();
  const lowerText = betterVersion.toLowerCase();

  // Find start position
  const startIndex = lowerText.indexOf(startWords);
  if (startIndex === -1) return null;

  // Find end position (must be after start)
  const searchFrom = startIndex + startWords.length;
  const endIndex = lowerText.indexOf(endWords, searchFrom);
  if (endIndex === -1) return null;

  return {
    start: startIndex,
    end: endIndex + endWords.length,
  };
}

/**
 * Renders betterVersion text with phrase highlighting on hover
 */
function BetterVersionText({
  text,
  suggestions,
  hoveredIndex,
}: {
  text: string;
  suggestions: Suggestion[];
  hoveredIndex: number | null;
}) {
  // If no suggestion is hovered, just return plain text
  if (hoveredIndex === null) {
    return <>{text}</>;
  }

  const suggestion = suggestions[hoveredIndex];
  if (!suggestion?.improved) {
    return <>{text}</>;
  }

  const range = findPhraseInText(suggestion.improved, text);
  if (!range) {
    // Couldn't find phrase, return plain text
    return <>{text}</>;
  }

  const before = text.slice(0, range.start);
  const highlighted = text.slice(range.start, range.end);
  const after = text.slice(range.end);
  const bgColor = categoryBgColors[suggestion.category];

  return (
    <>
      {before}
      <span className={`${bgColor} rounded px-0.5 transition-colors`}>
        {highlighted}
      </span>
      {after}
    </>
  );
}

export function SpeakBetterWidget() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedTone, setSelectedTone] = useState<ToneId>(() => loadTone());
  const [showSettings, setShowSettings] = useState(false);
  const [hoveredSuggestionIndex, setHoveredSuggestionIndex] = useState<number | null>(null);

  // Pause functionality
  const { isPaused, PauseButton, PauseOverlay } = useWidgetPause(
    "speak-better",
    "Speak Better",
  );

  // Track the last analyzed conversation ID to avoid re-analyzing
  // This is initialized from storage to prevent duplicate analysis on reload
  const lastAnalyzedIdRef = useRef<string | null>(null);
  const hasLoadedFromStorageRef = useRef(false);

  // Handle tone change
  const handleToneChange = useCallback((tone: ToneId) => {
    setSelectedTone(tone);
    saveTone(tone);
  }, []);

  // Load from storage on mount
  useEffect(() => {
    if (hasLoadedFromStorageRef.current) return;
    hasLoadedFromStorageRef.current = true;

    const stored = loadFromStorage();
    if (stored) {
      setResult(stored);
      setLoadingState("success");
      // Restore the last analyzed ID to prevent re-analyzing on reload
      lastAnalyzedIdRef.current = stored.conversationId;
    }
  }, []);

  // Format result for TTS narration
  // Only narrate the better version and vocabulary tips
  // Suggestions are visual-only (user can see them while speaking)
  const formatForSpeech = useCallback((result: AnalysisResult): string => {
    const parts: string[] = [];

    if (result.betterVersion) {
      parts.push(`Here's a better way to say it: — ${result.betterVersion}`);
    }

    if (result.vocabularyTips.length > 0) {
      parts.push("Vocabulary tips:");
      for (const tip of result.vocabularyTips) {
        parts.push(tip);
      }
    }

    return parts.join(" ");
  }, []);

  // Emit TTS event to narrate the result (if narrator widget is loaded, it will speak)
  const narrateResult = useCallback(
    (result: AnalysisResult) => {
      const text = formatForSpeech(result);
      if (text) {
        eventBus.emit("tts:speak", { text, mode: "queue" });
      }
    },
    [formatForSpeech],
  );

  // Analyze text
  const analyze = useCallback(
    async (conversationId: string, text: string) => {
      if (!text.trim()) return;

      setLoadingState("loading");
      setError(null);

      try {
        const analysisResult = await analyzeText(
          conversationId,
          text,
          selectedTone,
        );
        setResult(analysisResult);
        setLoadingState("success");
        // Narrate the result (narrator will speak if loaded)
        narrateResult(analysisResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
        setLoadingState("error");
      }
    },
    [narrateResult, selectedTone],
  );

  // Observe conversations for new user messages
  useEffect(() => {
    // Don't observe when paused
    if (isPaused) return;

    const conversations = database.get<Conversation>("conversations");
    const query = conversations.query(
      Q.where("speaker", "user"),
      Q.sortBy("timestamp", Q.desc),
      Q.take(1),
    );

    const subscription = query.observe().subscribe((results) => {
      if (results.length === 0) return;

      const latest = results[0];
      // Only analyze if this is a new conversation we haven't seen
      if (latest.id !== lastAnalyzedIdRef.current) {
        lastAnalyzedIdRef.current = latest.id;
        analyze(latest.id, latest.sanitizedText);
      }
    });

    return () => subscription.unsubscribe();
  }, [analyze, isPaused]);

  // Manual refresh with latest text
  const handleRefresh = useCallback(async () => {
    const conversations = database.get<Conversation>("conversations");
    const results = await conversations
      .query(
        Q.where("speaker", "user"),
        Q.sortBy("timestamp", Q.desc),
        Q.take(1),
      )
      .fetch();

    if (results.length > 0) {
      lastAnalyzedIdRef.current = results[0].id;
      analyze(results[0].id, results[0].sanitizedText);
    }
  }, [analyze]);

  // Error state
  if (loadingState === "error") {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:sparkles","title":"Speak Better","desc":"Helps you articulate better with vocabulary and conciseness suggestions."}'
      >
        <PauseOverlay />
        <AlertCircle className="w-5 h-5 mb-1 text-error" />
        <span className="text-[10px] text-base-content/60">{error}</span>
        <button onClick={handleRefresh} className="btn btn-xs btn-ghost mt-2">
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (!result || (!result.betterVersion && result.suggestions.length === 0)) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:sparkles","title":"Speak Better","desc":"Analyzes your speech and suggests better vocabulary and phrasing. Start talking to see suggestions."}'
      >
        <PauseOverlay />
        <Sparkles className="w-5 h-5 mb-1 opacity-40" />
        <span className="text-[10px]">
          {loadingState === "loading" ? "Analyzing..." : "No analysis yet"}
        </span>
        <span className="text-[9px] opacity-50">Start talking first</span>
        {loadingState === "loading" && (
          <span className="loading loading-spinner loading-xs mt-2 text-primary"></span>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:sparkles","title":"Speak Better","desc":"Shows how you could have said things better. Includes vocabulary tips and concise alternatives."}'
    >
      <PauseOverlay />
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {loadingState === "loading" ? (
            <>
              <span className="loading loading-spinner loading-xs text-primary"></span>
              <span className="text-[11px] font-medium text-primary">
                Analyzing...
              </span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-primary/60" />
              <span className="text-[11px] font-medium text-base-content/70">
                Speak Better
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
              showSettings
                ? "bg-primary/20 text-primary"
                : "text-base-content/40 hover:bg-base-200/50"
            }`}
            title="Tone settings"
            data-doc='{"title":"Tone Settings","desc":"Choose how you want to speak: professional, casual, witty, direct, and more. The AI will rewrite your speech to match the selected tone."}'
          >
            <Settings size={10} />
            <span className="max-w-[60px] truncate">
              {TONES[selectedTone].label}
            </span>
          </button>
          <PauseButton />
          <button
            onClick={handleRefresh}
            className="p-1 hover:bg-base-200 rounded transition-colors"
            title="Refresh"
            disabled={loadingState === "loading"}
          >
            <RefreshCw size={12} className="text-base-content/40" />
          </button>
        </div>
      </div>

      {/* Settings Panel - Collapsible */}
      {showSettings && (
        <div className="flex-shrink-0 bg-base-200/20 px-2 py-1.5 border-b border-base-200">
          <div className="text-[9px] text-base-content/50 mb-1">Tone</div>
          <select
            value={selectedTone}
            onChange={(e) => handleToneChange(e.target.value as ToneId)}
            className="w-full text-[10px] bg-base-100 border border-base-300 rounded px-1.5 py-1 text-base-content/70 cursor-pointer focus:outline-none focus:border-primary/50"
          >
            {(Object.keys(TONES) as ToneId[]).map((tone) => (
              <option key={tone} value={tone}>
                {TONES[tone].label} — {TONES[tone].description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-2 space-y-3">
        {/* Better Version with phrase highlighting */}
        {result.betterVersion && (
          <div className="bg-primary/5 rounded-lg p-2 border border-primary/20">
            <div className="text-[9px] uppercase tracking-wide text-primary/60 mb-1">
              Better way to say it
            </div>
            <p className="text-xs text-base-content/80 leading-relaxed">
              "
              <BetterVersionText
                text={result.betterVersion}
                suggestions={result.suggestions}
                hoveredIndex={hoveredSuggestionIndex}
              />
              "
            </p>
          </div>
        )}

        {/* Suggestions */}
        {result.suggestions.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wide text-base-content/40 mb-1.5">
              Improvements Made
            </div>
            <div className="space-y-2">
              {result.suggestions.map((suggestion, index) => {
                const Icon = categoryIcons[suggestion.category];
                const isHovered = hoveredSuggestionIndex === index;
                return (
                  <div
                    key={index}
                    className={`pl-2 py-1.5 border-l-2 rounded-r transition-colors cursor-default ${
                      categoryBorderColors[suggestion.category]
                    } ${isHovered ? "bg-base-200/60" : "bg-base-200/30"}`}
                    onMouseEnter={() => setHoveredSuggestionIndex(index)}
                    onMouseLeave={() => setHoveredSuggestionIndex(null)}
                  >
                    {/* Category label */}
                    <div className="flex items-center gap-1 mb-0.5">
                      <Icon size={10} className="opacity-60" />
                      <span className="text-[9px] font-medium text-base-content/50 uppercase tracking-wide">
                        {categoryLabels[suggestion.category]}
                      </span>
                    </div>
                    {/* Reason */}
                    <div className="text-[11px] text-base-content/70">
                      {suggestion.reason}
                    </div>
                    {/* Principle - the learning takeaway */}
                    {suggestion.principle && (
                      <div className="text-[10px] text-base-content/50 mt-1 italic">
                        💡 {suggestion.principle}
                      </div>
                    )}
                    {/* Alternative phrasing */}
                    {suggestion.alternative && (
                      <div className="text-[10px] text-base-content/40 mt-0.5">
                        Also: "{suggestion.alternative}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Vocabulary Tips */}
        {result.vocabularyTips.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wide text-base-content/40 mb-1.5 flex items-center gap-1">
              <BookOpen size={10} />
              Vocabulary
            </div>
            <div className="space-y-1">
              {result.vocabularyTips.map((tip, index) => (
                <div
                  key={index}
                  className="text-[10px] text-base-content/60 pl-2 border-l-2 border-purple-300/50"
                >
                  {tip}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer - context info */}
      <div className="flex-shrink-0 px-2 py-1 border-t border-base-200/50 flex items-center justify-end text-[9px] text-base-content/30 gap-2">
        <span data-doc='{"title":"LLM Duration","desc":"Time taken for the AI to analyze and generate suggestions."}'>
          {(result.durationMs / 1000).toFixed(1)}s
        </span>
        <span>·</span>
        <span data-doc='{"title":"Context Size","desc":"Input characters sent to AI → Output characters received. Asterisk (*) means input was truncated."}'>
          {result.inputChars.toLocaleString()}
          {result.truncated ? "*" : ""} → {result.outputChars.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
