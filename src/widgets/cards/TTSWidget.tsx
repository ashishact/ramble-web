/**
 * Narrator Widget - Text to Speech with compact design
 * Chunk-based display with gradient highlighting
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Icon } from '@iconify/react';
import { Play, Square, Pause, Loader2, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import type { WidgetProps } from '../types';
import { useTTS } from '../../hooks/useTTS';
import type { TTSSpeakEvent } from '../../services/tts/types';
import {
  voices,
  getLanguages,
  getVoicesByLanguage,
  DEFAULT_VOICE,
  type LanguageCode,
} from '../../services/tts/voices';
import { profileStorage } from '../../lib/profileStorage';

const TTS_TEXT_STORAGE_KEY = 'tts-widget-text';


export const TTSWidget: React.FC<WidgetProps> = () => {
  const {
    playbackState,
    progress,
    queueLength,
    currentVoice,
    parts,
    currentPartId,
    speak,
    queueText,
    stop,
    pause,
    resume,
    setVoice,
    playNext,
    playPrev,
    getPlayingAudioElement,
  } = useTTS();

  // Load text from profileStorage on mount
  const [text, setText] = useState(() => {
    return profileStorage.getItem(TTS_TEXT_STORAGE_KEY) || '';
  });
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>('en-gb');
  const [gradientProgress, setGradientProgress] = useState(0);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const currentPartRef = useRef<HTMLSpanElement>(null);

  // Persist text to profileStorage when it changes
  useEffect(() => {
    profileStorage.setItem(TTS_TEXT_STORAGE_KEY, text);
  }, [text]);

  // Alt+Click to speak any text on the page
  useEffect(() => {
    const handleAltClick = (e: MouseEvent) => {
      // Only handle Alt+Click
      if (!e.altKey) return;

      const target = e.target as HTMLElement;
      if (!target) return;

      // Get text content from the clicked element
      const textContent = target.textContent?.trim();
      if (!textContent) return;

      // Don't capture clicks on interactive elements
      const tagName = target.tagName.toLowerCase();
      if (['input', 'textarea', 'button', 'a', 'select'].includes(tagName)) {
        return;
      }

      // Prevent default behavior and stop propagation
      e.preventDefault();
      e.stopPropagation();

      console.log('[TTS] Alt+Click captured text:', textContent.slice(0, 50) + '...');

      // Play the text directly (we're inside the TTS component)
      stop(); // Stop any current playback
      speak(textContent);
    };

    // Add listener on mount
    document.addEventListener('click', handleAltClick, true); // Use capture phase

    // Remove listener on unmount
    return () => {
      document.removeEventListener('click', handleAltClick, true);
    };
  }, [speak, stop]);

  // Get available languages
  const languages = useMemo(() => getLanguages(), []);

  // Get voices for selected language
  const availableVoices = useMemo(
    () => getVoicesByLanguage(selectedLanguage),
    [selectedLanguage]
  );

  // Ensure current voice matches language on language change
  useEffect(() => {
    const voiceInLang = availableVoices.find(v => v.id === currentVoice);
    if (!voiceInLang && availableVoices.length > 0) {
      setVoice(availableVoices[0].id);
    }
  }, [selectedLanguage, availableVoices, currentVoice, setVoice]);

  // Initialize language from default voice
  useEffect(() => {
    const defaultVoiceDef = voices.find(v => v.id === DEFAULT_VOICE);
    if (defaultVoiceDef) {
      setSelectedLanguage(defaultVoiceDef.language);
    }
  }, []);

  // Listen for cross-widget TTS events
  useEffect(() => {
    const handleSpeak = (e: CustomEvent<TTSSpeakEvent>) => {
      const { text: eventText, voice, mode = 'replace' } = e.detail;

      if (voice) {
        setVoice(voice);
        // Update language to match voice
        const voiceDef = voices.find(v => v.id === voice);
        if (voiceDef) {
          setSelectedLanguage(voiceDef.language);
        }
      }

      if (mode === 'replace') {
        stop();
        speak(eventText);
      } else {
        queueText(eventText, voice);
      }
    };

    const handleStop = () => stop();

    window.addEventListener('tts:speak', handleSpeak as EventListener);
    window.addEventListener('tts:stop', handleStop);

    return () => {
      window.removeEventListener('tts:speak', handleSpeak as EventListener);
      window.removeEventListener('tts:stop', handleStop);
    };
  }, [speak, queueText, stop, setVoice]);

  // Arrow key navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if TTS is active and widget is focused or no specific element is focused
      if (!isActive) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        playPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        playNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playNext, playPrev, playbackState]);

  // Update gradient progress - use polling to ensure we always have the right audio element
  useEffect(() => {
    // Reset progress when part changes
    setGradientProgress(0);

    if (playbackState !== 'playing') return;

    // Poll for progress updates - more reliable than event listeners across audio element changes
    const intervalId = setInterval(() => {
      const audioElement = getPlayingAudioElement();
      if (!audioElement) return;

      const duration = audioElement.duration;
      // Only calculate if duration is valid
      if (!isFinite(duration) || duration <= 0) return;

      const currentTime = audioElement.currentTime;
      // Offset for silence at end (like Stobo)
      const totalDuration = Math.max(duration - 0.5, 0.1);
      let percent = currentTime / totalDuration;
      if (percent > 1) percent = 1;
      setGradientProgress(percent);
    }, 50); // Update every 50ms for smooth animation

    return () => {
      clearInterval(intervalId);
    };
  }, [getPlayingAudioElement, currentPartId, playbackState]);

  // Auto-scroll to current part
  useEffect(() => {
    if (currentPartRef.current) {
      currentPartRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentPartId]);

  const handleSpeak = useCallback(() => {
    if (!text.trim()) return;
    speak(text.trim());
  }, [text, speak]);

  const handlePlayPause = useCallback(() => {
    if (playbackState === 'playing') {
      pause();
    } else if (playbackState === 'paused') {
      resume();
    }
  }, [playbackState, pause, resume]);

  const isLoading = playbackState === 'loading-model';
  const isGenerating = playbackState === 'generating';
  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';
  const isActive = isPlaying || isPaused;
  const isBusy = isLoading || isGenerating;
  const canPlay = text.trim().length > 0 && !isBusy && !isActive;

  // Get progress percentage for model loading
  const loadingProgressPercent = progress?.progress ?? 0;

  // Generate gradient style for current chunk
  const getGradientStyle = (isCurrentPart: boolean): React.CSSProperties => {
    if (!isCurrentPart) {
      return {};
    }

    if (isPaused) {
      return {
        background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
        borderRadius: '0.375rem',
        padding: '0 0.25rem',
      };
    }

    const bandWidth = 10;
    const start = gradientProgress * (100 - bandWidth);
    const middle = gradientProgress * 100;
    const end = start + bandWidth;
    const baseColor = 'color-mix(in srgb, var(--color-primary) 10%, transparent)';
    const bandOuter = 'color-mix(in srgb, var(--color-primary) 30%, transparent)';
    const bandCenter = 'color-mix(in srgb, var(--color-primary) 50%, transparent)';

    return {
      background: `linear-gradient(to right, ${baseColor} 0%, ${bandOuter} ${start}%, ${bandCenter} ${middle}%, ${bandOuter} ${end}%, ${baseColor} 100%)`,
      borderRadius: '0.375rem',
      padding: '0 0.25rem',
      transition: 'background 100ms',
    };
  };

  // Get current voice info for display
  const currentVoiceInfo = availableVoices.find(v => v.id === currentVoice);

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:account-voice","title":"Narrator","desc":"Read text aloud with 54 voices in 8 languages. Use ← → to navigate chunks. Alt+Click any text on page to narrate it."}'
    >
      {/* Header - Compact */}
      <div className="bg-base-200/30 px-2 py-1 flex items-center justify-between border-b border-base-200 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:account-voice" className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-medium text-[11px]">Narrator</span>
          {queueLength > 0 && (
            <span className="text-[9px] px-1 py-0.5 bg-primary/20 text-primary rounded">
              {queueLength}
            </span>
          )}
          {(isLoading || isGenerating) && (
            <Loader2 size={10} className="animate-spin text-primary/60" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Voice indicator */}
          <button
            onClick={() => setShowVoiceSettings(!showVoiceSettings)}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
              showVoiceSettings
                ? 'bg-primary/20 text-primary'
                : 'text-base-content/40 hover:bg-base-200/50'
            }`}
            disabled={isActive}
            data-doc='{"icon":"mdi:cog","title":"Voice Settings","desc":"Change language and voice for narration"}'
          >
            <Settings size={10} />
            <span className="max-w-[60px] truncate">{currentVoiceInfo?.name || 'Voice'}</span>
          </button>
        </div>
      </div>

      {/* Voice Settings - Collapsible */}
      {showVoiceSettings && !isActive && (
        <div className="bg-base-200/20 px-2 py-1.5 border-b border-base-200 flex gap-1.5 flex-shrink-0">
          <select
            className="flex-1 px-1.5 py-1 text-[10px] bg-base-100 border border-base-300 rounded focus:outline-none focus:border-primary/50"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value as LanguageCode)}
            data-doc='{"icon":"mdi:translate","title":"Language","desc":"Select language for narration"}'
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
          <select
            className="flex-1 px-1.5 py-1 text-[10px] bg-base-100 border border-base-300 rounded focus:outline-none focus:border-primary/50"
            value={currentVoice}
            onChange={(e) => setVoice(e.target.value)}
            data-doc='{"icon":"mdi:account-voice","title":"Voice","desc":"Choose a voice for narration"}'
          >
            {availableVoices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.gender === 'female' ? 'F' : 'M'})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Progress Bar (model loading) */}
      {progress && progress.type === 'model-download' && (
        <div className="px-2 py-1 bg-base-200/20 border-b border-base-200 flex-shrink-0">
          <progress
            className="progress progress-primary w-full h-1"
            value={loadingProgressPercent}
            max={100}
          />
          {progress.message && (
            <p className="text-[9px] opacity-50 truncate mt-0.5">{progress.message}</p>
          )}
        </div>
      )}

      {/* Text Input OR Chunk-based Display - Same styling for both */}
      {isActive && parts.length > 0 ? (
        /* Chunk-based display with gradient on current chunk - matches textarea styling */
        <div
          ref={containerRef}
          className="flex-1 w-full p-2 overflow-auto bg-base-100 text-xs leading-relaxed text-base-content/80"
        >
          {parts.map((part, idx) => {
            const isCurrentPart = part.id === currentPartId;
            // Add paragraph break before parts that start a new paragraph (except first)
            const needsParagraphBreak = idx > 0 && part.isFirstInParagraph;

            return (
              <span key={part.id}>
                {needsParagraphBreak && (
                  <>
                    <br />
                    <br />
                  </>
                )}
                <span
                  id={part.id}
                  ref={isCurrentPart ? currentPartRef : null}
                  className={isCurrentPart ? 'narrator-highlight' : ''}
                  style={getGradientStyle(isCurrentPart)}
                >
                  {part.text}
                </span>
                {idx < parts.length - 1 && !parts[idx + 1]?.isFirstInParagraph && ' '}
              </span>
            );
          })}
        </div>
      ) : (
        /* Text Input */
        <textarea
          className="flex-1 w-full p-2 bg-base-100 border-0 resize-none focus:outline-none text-xs leading-relaxed text-base-content/80 placeholder:text-base-content/30"
          placeholder="Enter text to narrate..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isLoading}
          data-doc='{"icon":"mdi:text-box-edit-outline","title":"Text Input","desc":"Enter or paste text here. Alt+Click anywhere to narrate that text."}'
        />
      )}

      {/* Controls - Compact footer */}
      <div className="bg-base-200/30 px-2 py-1.5 border-t border-base-200 flex items-center gap-1 flex-shrink-0">
        {!isActive ? (
          <>
            <button
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium bg-primary/90 text-primary-content rounded hover:bg-primary transition-colors disabled:opacity-40"
              onClick={handleSpeak}
              disabled={!canPlay}
              data-doc='{"icon":"mdi:play","title":"Narrate","desc":"Start narrating the text"}'
            >
              {isBusy ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Play size={10} />
              )}
              {isLoading ? 'Loading...' : isGenerating ? 'Generating...' : 'Narrate'}
            </button>
          </>
        ) : (
          <>
            {/* Previous chunk */}
            <button
              className="p-1 text-base-content/40 hover:text-base-content/70 hover:bg-base-200/50 rounded transition-colors"
              onClick={playPrev}
              data-doc='{"icon":"mdi:skip-previous","title":"Previous","desc":"Go to previous chunk (← arrow key)"}'
            >
              <ChevronLeft size={14} />
            </button>

            {/* Play/Pause */}
            <button
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium bg-primary/90 text-primary-content rounded hover:bg-primary transition-colors"
              onClick={handlePlayPause}
              data-doc={isPlaying
                ? '{"icon":"mdi:pause","title":"Pause","desc":"Pause narration"}'
                : '{"icon":"mdi:play","title":"Resume","desc":"Resume narration"}'
              }
            >
              {isPlaying ? <Pause size={10} /> : <Play size={10} />}
              {isPlaying ? 'Pause' : 'Resume'}
            </button>

            {/* Next chunk */}
            <button
              className="p-1 text-base-content/40 hover:text-base-content/70 hover:bg-base-200/50 rounded transition-colors"
              onClick={playNext}
              data-doc='{"icon":"mdi:skip-next","title":"Next","desc":"Skip to next chunk (→ arrow key)"}'
            >
              <ChevronRight size={14} />
            </button>

            {/* Stop */}
            <button
              className="p-1 text-base-content/40 hover:text-error/70 hover:bg-error/10 rounded transition-colors"
              onClick={stop}
              data-doc='{"icon":"mdi:stop","title":"Stop","desc":"Stop narration and clear queue"}'
            >
              <Square size={12} />
            </button>

            {/* Chunk indicator */}
            {parts.length > 1 && (
              <span className="text-[9px] text-base-content/40 ml-1">
                {parts.findIndex(p => p.id === currentPartId) + 1}/{parts.length}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};
