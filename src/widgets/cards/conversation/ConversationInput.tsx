/**
 * ConversationInput — Bottom input bar
 *
 * States: idle → recording → processing → success | error → idle
 *
 * Recording row (single line):
 *   [3 wave bars]  [10 chunk ticks]  0:08 audio  ·  0:12 elapsed  ·  REC •
 *
 * Chunk ticks fill left-to-right as audio is buffered (each = 1s / 5 blobs).
 * They reset when a mid-recording flush happens, giving a sense of "batch sent".
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSys1 } from '../../../services/useSys1';
import { eventBus } from '../../../lib/eventBus';
import { uploadAttachment, type UploadedAttachment } from '../../../services/rambleApi';

// ── Audio tones ───────────────────────────────────────────────────────────────

function playStartTone() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.275, t);   // 0.55 × 0.5
    master.connect(ctx.destination);

    const partials: [number, number, number][] = [
      [1.0,   0.7,  0.35],
      [2.76,  0.4,  0.18],
      [5.40,  0.2,  0.10],
      [8.93,  0.1,  0.06],
      [13.34, 0.05, 0.04],
    ];
    const fundamental = 1050;

    partials.forEach(([ratio, amp, decay]) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env); env.connect(master);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fundamental * ratio, t);
      env.gain.setValueAtTime(amp, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + decay);
      osc.start(t); osc.stop(t + decay);
    });

    const bufSize = ctx.sampleRate * 0.015;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3000;
    noiseFilter.Q.value = 0.8;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.075, t);   // 0.15 × 0.5
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    noise.connect(noiseFilter); noiseFilter.connect(noiseEnv); noiseEnv.connect(master);
    noise.start(t);

    setTimeout(() => ctx.close(), 600);
  } catch { /* audio not available */ }
}

function playStopTone() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.3, t);   // 0.6 × 0.5
    master.connect(ctx.destination);

    const body = ctx.createOscillator();
    const bodyEnv = ctx.createGain();
    body.connect(bodyEnv); bodyEnv.connect(master);
    body.type = 'sine';
    body.frequency.setValueAtTime(160, t);
    body.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    bodyEnv.gain.setValueAtTime(0.8, t);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    body.start(t); body.stop(t + 0.28);

    const harm = ctx.createOscillator();
    const harmEnv = ctx.createGain();
    harm.connect(harmEnv); harmEnv.connect(master);
    harm.type = 'sine';
    harm.frequency.setValueAtTime(320, t);
    harm.frequency.exponentialRampToValueAtTime(110, t + 0.06);
    harmEnv.gain.setValueAtTime(0.25, t);
    harmEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    harm.start(t); harm.stop(t + 0.08);

    const bufSize = ctx.sampleRate * 0.03;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 280;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.25, t);   // 0.5 × 0.5
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    noise.connect(noiseFilter); noiseFilter.connect(noiseEnv); noiseEnv.connect(master);
    noise.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch { /* audio not available */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── Recording status row ──────────────────────────────────────────────────────

// Max server chunks to show as ticks (one tick per API call sent)
const MAX_CHUNK_TICKS = 8;

interface RecordingRowProps {
  chunksSent: number;   // how many chunks sent to transcription server
  speechMs: number;     // VAD-gated speech duration
  wallClockMs: number;  // ms since recording started
}

function RecordingRow({ chunksSent, speechMs, wallClockMs }: RecordingRowProps) {
  return (
    <div className="flex items-center gap-3 w-full px-1">
      {/* Wave bars */}
      <div className="flex items-center gap-[3px] shrink-0">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-[2px] rounded-full bg-rose-400/70 animate-wavebar"
            style={{ height: '14px', animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>

      {/* Server chunk ticks — 1 tick per API call, accumulates whole session */}
      <div className="flex items-center gap-[3px] shrink-0">
        {Array.from({ length: MAX_CHUNK_TICKS }).map((_, i) => (
          <div
            key={i}
            className={`w-[4px] h-[12px] rounded-sm transition-all duration-300 ${
              i < chunksSent ? 'bg-violet-400/80' : 'bg-base-content/10'
            }`}
          />
        ))}
        {chunksSent > MAX_CHUNK_TICKS && (
          <span className="text-[9px] text-violet-400/60 font-mono ml-0.5">+{chunksSent - MAX_CHUNK_TICKS}</span>
        )}
      </div>

      {/* Timers */}
      <div className="flex items-center gap-2 text-[10px] font-mono text-base-content/35 shrink-0">
        <span title="speech time">{formatTime(speechMs)}</span>
        <span className="text-base-content/15">·</span>
        <span title="elapsed">{formatTime(wallClockMs)}</span>
      </div>

      {/* State label */}
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
        <span className="text-[10px] font-medium tracking-wide text-rose-400/80">REC</span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type InputState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConversationInput() {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputState, setInputState] = useState<InputState>('idle');
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Recording metrics
  const [chunksSent, setChunksSent] = useState(0);
  const [speechMs, setSpeechMs] = useState(0);
  const [wallClockMs, setWallClockMs] = useState(0);
  const recordingStartRef = useRef<number>(0);
  const wallClockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sendMessage } = useSys1();

  // Auto-resize textarea as content grows
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    const onStart = () => {
      setInputState('recording');
      setChunksSent(0);
      setSpeechMs(0);
      setWallClockMs(0);
      recordingStartRef.current = Date.now();
      wallClockTimerRef.current = setInterval(() => {
        setWallClockMs(Date.now() - recordingStartRef.current);
      }, 200);
      playStartTone();
    };

    const onStop = () => {
      if (wallClockTimerRef.current) {
        clearInterval(wallClockTimerRef.current);
        wallClockTimerRef.current = null;
      }
      playStopTone();
    };

    const onChunkSent = ({ chunksSent: n }: { chunksSent: number; totalSentAudioMs: number }) => {
      setChunksSent(n);
    };

    const onVadDuration = ({ totalSpeechMs }: { totalSpeechMs: number }) => {
      setSpeechMs(totalSpeechMs);
    };

    const onProcessing = () => setInputState('processing');

    const onDone = ({ success }: { success: boolean }) => {
      setInputState(success ? 'success' : 'error');
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setInputState('idle'), success ? 1500 : 2500);
    };

    const subs = [
      eventBus.on('stt:recording-started', onStart),
      eventBus.on('stt:recording-stopped', onStop),
      eventBus.on('stt:chunk-sent', onChunkSent),
      eventBus.on('stt:vad-duration', onVadDuration),
      eventBus.on('stt:processing', onProcessing),
      eventBus.on('stt:processing-done', onDone),
    ];

    return () => {
      subs.forEach(fn => fn());
      if (wallClockTimerRef.current) clearInterval(wallClockTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSubmitting || uploading) return;
    setIsSubmitting(true);
    const pending = attachments;
    setText('');
    setAttachments([]);
    try {
      await sendMessage(trimmed, pending.length > 0 ? pending : undefined);
    } catch (err) {
      console.error('Failed to submit input:', err);
    } finally {
      setIsSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [text, attachments, isSubmitting, uploading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(uploadAttachment));
      setAttachments(prev => [...prev, ...uploaded]);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, []);

  const removeAttachment = useCallback((r2Key: string) => {
    setAttachments(prev => prev.filter(a => a.r2Key !== r2Key));
  }, []);

  const renderStatus = () => {
    if (inputState === 'recording') {
      return (
        <RecordingRow
          chunksSent={chunksSent}
          speechMs={speechMs}
          wallClockMs={wallClockMs}
        />
      );
    }

    if (inputState === 'processing') {
      return (
        <div className="flex items-center gap-2 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
          <span className="text-[11px] text-amber-400/70 tracking-wide">Analyzing…</span>
        </div>
      );
    }

    if (inputState === 'success') {
      return (
        <div className="flex items-center gap-2 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
          <span className="text-[11px] text-emerald-400/80 tracking-wide">Done</span>
        </div>
      );
    }

    if (inputState === 'error') {
      return (
        <div className="flex items-center gap-2 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500/80" />
          <span className="text-[11px] text-rose-500/80 tracking-wide">Failed</span>
        </div>
      );
    }

    return (
      <div className="flex items-end gap-2 w-full">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type something..."
          rows={1}
          disabled={isSubmitting}
          className="flex-1 bg-transparent text-base text-base-content/90 placeholder:text-base-content/25
                     resize-none outline-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '1.5em', maxHeight: '200px', caretColor: 'oklch(var(--p))' }}
        />

        {/* File picker button — right side */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSubmitting || uploading}
          className="shrink-0 mb-[3px] p-1 rounded-md text-base-content/30 hover:text-base-content/60 hover:bg-base-200/60 transition disabled:opacity-30"
          title="Attach file"
        >
          {uploading
            ? <span className="loading loading-spinner loading-xs" />
            : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          }
        </button>
      </div>
    );
  };

  return (
    <div className="border-t border-base-200/60 bg-base-100 shrink-0 flex gap-3">
      {/* Blinking purple bar — mirrors the user message indicator */}
      <div
        className="w-[2px] rounded-full bg-violet-400/80 animate-cursor-blink self-center ml-3 shrink-0"
        style={{ height: '1.6em' }}
      />

      {/* Content */}
      <div className="flex-1 py-2.5 pr-4">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map(a => (
              <div key={a.r2Key} className="flex items-center gap-1.5 px-2.5 py-1 bg-base-200 rounded-lg text-xs text-base-content/70 max-w-[200px]">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span className="truncate">{a.filename}</span>
                <span className="text-base-content/30 shrink-0">{formatBytes(a.size)}</span>
                <button
                  onClick={() => removeAttachment(a.r2Key)}
                  className="shrink-0 ml-0.5 opacity-40 hover:opacity-80 transition"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center min-h-[36px]">
          {renderStatus()}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
