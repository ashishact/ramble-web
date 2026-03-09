import { useState, useEffect, useRef, useCallback } from 'react';
import { eventBus } from '../../../lib/eventBus';
import { profileStorage } from '../../../lib/profileStorage';
import { useWidgetPause } from '../useWidgetPause';
import { getWidgetValue, updateWidgetState } from '../widgetState';
import { detectSearchNeed } from './process';
import type { DetectionResult } from './process';
import { Search, Loader2, AlertCircle, Globe, Zap, Mic, Monitor, Radio, BrainCircuit } from 'lucide-react';

const STORAGE_KEY = 'google-search-results';
const MAX_RESULTS = 30;
const TRIM_THRESHOLD = 30;
const TRIM_TO = 25;

/** Minimum accumulated transcript chars before checking */
const MIN_TRANSCRIPT_CHARS = 30;

type AudioFilter = 'all' | 'mic' | 'system';

type SearchResult = {
  query: string;
  readability: string | null;
  raw: string | null;
  source: string | null;
  cardImage: string | null;
  title: string | null;
  excerpt: string | null;
  timestamp: number;
  auto?: boolean; // true if triggered by auto-detection
  llmQuestion?: string | null;
  llmAnswer?: string | null;
  type?: 'search' | 'llm-only'; // 'llm-only' when no search was triggered
};

function loadResults(): SearchResult[] {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function trimResults(results: SearchResult[]): SearchResult[] {
  if (results.length > TRIM_THRESHOLD) {
    return results.slice(0, TRIM_TO);
  }
  return results;
}

function saveResults(results: SearchResult[]) {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  } catch {}
}

export function GoogleSearchWidget({ nodeId }: { nodeId: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>(() => loadResults());
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRequestRef = useRef<string | null>(null);

  // Pause functionality
  const { isPaused, PauseButton } = useWidgetPause(nodeId, 'Google Search');

  // Audio source filter (persisted in widget state)
  const [audioFilter, setAudioFilter] = useState<AudioFilter>(() =>
    getWidgetValue<AudioFilter>(nodeId, 'audioFilter', 'all')
  );
  const audioFilterRef = useRef(audioFilter);
  audioFilterRef.current = audioFilter;

  const cycleAudioFilter = useCallback(() => {
    const next: AudioFilter = audioFilter === 'all' ? 'mic' : audioFilter === 'mic' ? 'system' : 'all';
    setAudioFilter(next);
    updateWidgetState(nodeId, { audioFilter: next });
  }, [audioFilter, nodeId]);

  // History navigation
  const historyIndexRef = useRef(-1);
  const savedQueryRef = useRef('');

  // Auto-detection state
  const accumulatedTextRef = useRef('');
  const detectingRef = useRef(false);
  const recentAutoQueriesRef = useRef<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  // Pending detection result — holds LLM answer while Google search is in flight
  const pendingDetectionRef = useRef<DetectionResult | null>(null);

  const queries = results.filter(r => r.type !== 'llm-only').map(r => r.query);

  // Fire a search (manual or auto)
  const fireSearch = useCallback((q: string, auto = false) => {
    if (!q.trim() || loading) return;

    const requestId = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    pendingRequestRef.current = requestId;
    setLoading(true);
    setError(null);

    // Tag auto searches so we can mark them in results
    if (auto) {
      (window as any).__rambleAutoSearchFlag = true;
    }

    eventBus.emit('ext:google-search', { query: q.trim(), requestId });
  }, [loading]);

  const handleSearch = useCallback(() => {
    if (!query.trim() || loading) return;
    historyIndexRef.current = -1;
    pendingDetectionRef.current = null; // manual search, no LLM answer
    fireSearch(query);
    setQuery('');
  }, [query, loading, fireSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') return; // handled by form submit
    if (queries.length === 0) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        savedQueryRef.current = query;
      }
      const next = Math.min(historyIndexRef.current + 1, queries.length - 1);
      historyIndexRef.current = next;
      setQuery(queries[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIndexRef.current - 1;
      if (next < 0) {
        historyIndexRef.current = -1;
        setQuery(savedQueryRef.current);
      } else {
        historyIndexRef.current = next;
        setQuery(queries[next]);
      }
    } else {
      historyIndexRef.current = -1;
    }
  }, [query, queries]);

  // Listen for search results via window CustomEvents
  useEffect(() => {
    const handleResult = (e: Event) => {
      const { query: q, result, requestId } = (e as CustomEvent).detail || {};
      if (pendingRequestRef.current && pendingRequestRef.current !== requestId) return;
      setLoading(false);
      pendingRequestRef.current = null;

      const isAuto = !!(window as any).__rambleAutoSearchFlag;
      delete (window as any).__rambleAutoSearchFlag;

      // Attach LLM answer from pending detection
      const detection = pendingDetectionRef.current;
      pendingDetectionRef.current = null;

      let parsed: SearchResult;
      try {
        const data = JSON.parse(result);
        parsed = {
          query: q,
          readability: data.readability,
          raw: data.raw,
          source: data.source || null,
          cardImage: data.cardImage || null,
          title: data.title,
          excerpt: data.excerpt,
          timestamp: Date.now(),
          auto: isAuto,
          type: 'search',
          llmQuestion: detection?.llm?.question ?? null,
          llmAnswer: detection?.llm?.answer ?? null,
        };
      } catch {
        parsed = {
          query: q,
          readability: null,
          raw: result,
          source: null,
          cardImage: null,
          title: null,
          excerpt: null,
          timestamp: Date.now(),
          auto: isAuto,
          type: 'search',
          llmQuestion: detection?.llm?.question ?? null,
          llmAnswer: detection?.llm?.answer ?? null,
        };
      }
      setResults(prev => {
        const updated = trimResults([parsed, ...prev]);
        saveResults(updated);
        return updated;
      });
      setQuery('');
    };

    const handleError = (e: Event) => {
      const { error: err, requestId } = (e as CustomEvent).detail || {};
      if (pendingRequestRef.current && pendingRequestRef.current !== requestId) return;
      setLoading(false);
      pendingRequestRef.current = null;
      delete (window as any).__rambleAutoSearchFlag;
      pendingDetectionRef.current = null;
      setError(err);
    };

    // Read stored value in case events fired before mount
    const stored = (window as any).__rambleGoogleSearchResult;
    if (stored) {
      try {
        const data = JSON.parse(stored.result);
        const parsed: SearchResult = { query: stored.query, readability: data.readability, raw: data.raw, source: data.source || null, cardImage: data.cardImage || null, title: data.title, excerpt: data.excerpt, timestamp: Date.now(), type: 'search' };
        setResults(prev => {
          const updated = [parsed, ...prev].slice(0, MAX_RESULTS);
          saveResults(updated);
          return updated;
        });
      } catch {}
      delete (window as any).__rambleGoogleSearchResult;
    }

    window.addEventListener('ramble:ext:google-search-result', handleResult);
    window.addEventListener('ramble:ext:google-search-error', handleError);
    return () => {
      window.removeEventListener('ramble:ext:google-search-result', handleResult);
      window.removeEventListener('ramble:ext:google-search-error', handleError);
    };
  }, []);

  // Auto-detection: on each transcript event, check if search is needed
  useEffect(() => {
    if (isPaused) {
      setStatus('paused');
      return;
    }
    setStatus('listening');

    const unsub = eventBus.on('native:transcription-intermediate', (payload) => {
      if (!payload.text) return;
      // Filter by audio source
      const filter = audioFilterRef.current;
      if (filter !== 'all' && payload.audioType && payload.audioType !== filter) return;
      accumulatedTextRef.current += ' ' + payload.text;
      const len = accumulatedTextRef.current.trim().length;
      console.log(`[GoogleSearch] transcript +${payload.text.length} chars, accumulated: ${len}`);
      setStatus(`${len} chars accumulated`);

      if (len < MIN_TRANSCRIPT_CHARS) return;
      if (detectingRef.current) {
        setStatus(`${len} chars (waiting for LLM...)`);
        return;
      }

      detectingRef.current = true;
      setDetecting(true);
      const textToAnalyze = accumulatedTextRef.current.trim();
      accumulatedTextRef.current = '';
      setStatus('asking LLM...');
      console.log('[GoogleSearch] sending to LLM:', textToAnalyze.slice(0, 80));

      detectSearchNeed(textToAnalyze).then(result => {
        detectingRef.current = false;
        setDetecting(false);

        // Always add LLM answer as a result if present
        if (result.llm?.question && result.llm?.answer) {
          if (result.search && result.query) {
            // Search will happen — store detection for when search result arrives
            const q = result.query.toLowerCase();
            if (recentAutoQueriesRef.current.includes(q)) {
              // Duplicate search — still show LLM answer
              setStatus(`skip duplicate: ${result.query}`);
              console.log('[GoogleSearch] skip duplicate search, showing LLM answer');
              addLLMOnlyResult(result);
              return;
            }
            recentAutoQueriesRef.current = [...recentAutoQueriesRef.current.slice(-10), q];
            pendingDetectionRef.current = result;
            setStatus(`searching: ${result.query}`);
            console.log('[GoogleSearch] auto-search:', result.query);
            fireSearch(result.query, true);
          } else {
            // No search needed — show LLM answer on its own
            setStatus('answered by LLM');
            console.log('[GoogleSearch] LLM answered, no search needed');
            addLLMOnlyResult(result);
          }
        } else if (result.search && result.query) {
          // Search without LLM answer (shouldn't happen often)
          const q = result.query.toLowerCase();
          if (recentAutoQueriesRef.current.includes(q)) {
            setStatus(`skip duplicate: ${result.query}`);
            return;
          }
          recentAutoQueriesRef.current = [...recentAutoQueriesRef.current.slice(-10), q];
          pendingDetectionRef.current = result;
          setStatus(`searching: ${result.query}`);
          fireSearch(result.query, true);
        } else {
          setStatus('no search needed');
          console.log('[GoogleSearch] LLM said no search needed, no answer');
        }
      }).catch((err) => {
        detectingRef.current = false;
        setDetecting(false);
        setStatus('LLM error');
        console.error('[GoogleSearch] detection error:', err);
      });
    });

    return () => {
      unsub();
      accumulatedTextRef.current = '';
    };
  }, [isPaused, fireSearch]);

  function addLLMOnlyResult(result: DetectionResult) {
    const entry: SearchResult = {
      query: result.llm!.question,
      readability: null,
      raw: null,
      source: null,
      cardImage: null,
      title: null,
      excerpt: null,
      timestamp: Date.now(),
      auto: true,
      type: 'llm-only',
      llmQuestion: result.llm!.question,
      llmAnswer: result.llm!.answer,
    };
    setResults(prev => {
      const updated = trimResults([entry, ...prev]);
      saveResults(updated);
      return updated;
    });
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:google","title":"Google Search","desc":"Search Google via the Chrome extension. Auto-detects search needs from conversation. Up/Down arrows to navigate search history."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center gap-1.5">
        <Globe className="w-3.5 h-3.5 text-base-content/40" />
        <span className="text-[11px] font-medium text-base-content/70">Google</span>
        {status && (
          <span className={`text-[8px] truncate flex items-center gap-0.5 ${
            detecting ? 'text-amber-500/70' :
            status.startsWith('searching') ? 'text-primary/70' :
            status === 'answered by LLM' ? 'text-violet-500/70' :
            'text-base-content/30'
          }`}>
            {detecting && <Zap size={7} />}
            {status}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          <button
            onClick={cycleAudioFilter}
            className="btn btn-ghost btn-xs px-1 h-5 min-h-0 tooltip tooltip-bottom"
            data-tip={audioFilter === 'all' ? 'All audio' : audioFilter === 'mic' ? 'Mic only' : 'System only'}
          >
            {audioFilter === 'all' && <Radio size={10} className="text-base-content/40" />}
            {audioFilter === 'mic' && <Mic size={10} className="text-primary/70" />}
            {audioFilter === 'system' && <Monitor size={10} className="text-secondary/70" />}
          </button>
          <PauseButton />
        </div>
      </div>

      {/* Search Input */}
      <div className="flex-shrink-0 px-2 py-2">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="flex items-center gap-1.5"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search Google... (↑↓ history)"
            disabled={loading}
            className="flex-1 input input-xs input-bordered bg-base-200/50 text-xs placeholder:text-base-content/30"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="btn btn-xs btn-ghost"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin text-primary" />
            ) : (
              <Search size={12} className="text-base-content/50" />
            )}
          </button>
        </form>
        {error && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-error">
            <AlertCircle size={10} />
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-2 pb-2">
        {results.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-base-content/30">
            <Search className="w-5 h-5 mb-1 opacity-40" />
            <span className="text-[10px]">No results yet</span>
            <span className="text-[9px] opacity-50">Type a query or start talking</span>
          </div>
        )}
        {results.map((r, i) => (
          <div
            key={`${r.timestamp}-${i}`}
            className={`mb-3 rounded-lg ${
              r.type === 'llm-only'
                ? 'bg-violet-500/5 border border-violet-500/10'
                : i === 0 ? 'bg-primary/5 border border-primary/10' : 'bg-base-200/40'
            }`}
          >
            <div className="px-2 pt-2 pb-1 flex items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-primary/70 truncate flex items-center gap-1">
                  {r.type === 'llm-only' && <BrainCircuit size={9} className="text-violet-500 flex-shrink-0" />}
                  {r.auto && r.type !== 'llm-only' && <Zap size={8} className="text-amber-500 flex-shrink-0" />}
                  {r.type === 'llm-only' ? r.llmQuestion : r.query}
                </div>
                {r.title && r.type !== 'llm-only' && (
                  <div className="text-[9px] text-base-content/40 truncate">{r.title}</div>
                )}
              </div>
              {r.type === 'llm-only' ? (
                <span className="flex-shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500/70 font-medium whitespace-nowrap">
                  LLM
                </span>
              ) : r.source ? (
                <span className="flex-shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/60 font-medium whitespace-nowrap">
                  {r.source}
                </span>
              ) : null}
            </div>

            {/* LLM Answer — shown for both llm-only and search results that have it */}
            {r.llmAnswer && (
              <div className="px-2 pb-1.5">
                <div className="bg-violet-500/5 border border-violet-500/10 rounded-md px-2.5 py-2">
                  <div className="flex items-center gap-1 mb-1">
                    <BrainCircuit size={8} className="text-violet-500/60" />
                    <span className="text-[8px] font-medium text-violet-500/60 uppercase tracking-wider">LLM Answer</span>
                  </div>
                  <div className="text-xs text-base-content/70 leading-snug whitespace-pre-wrap break-words">
                    {r.llmAnswer}
                  </div>
                </div>
              </div>
            )}

            {/* Card screenshot */}
            {r.cardImage && (
              <div className="px-2 pb-1.5 overflow-hidden">
                <div className="bg-white rounded-lg p-2">
                  <img src={r.cardImage} alt="Search card" className="w-full h-auto rounded object-contain" />
                </div>
              </div>
            )}

            {/* Text content (Google search results) */}
            {r.type !== 'llm-only' && (
              (r.raw || r.readability) ? (
                <div className="px-2 pb-2 overflow-hidden">
                  <div className="text-xs text-base-content/70 leading-snug whitespace-pre-wrap break-words">
                    {r.raw || r.readability}
                  </div>
                </div>
              ) : !r.cardImage ? (
                <div className="px-2 pb-2 text-xs text-base-content/40 italic">No results</div>
              ) : null
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
