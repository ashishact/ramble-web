# Groq Whisper Intelligent Chunking

## Overview

The Groq Whisper Large V3 Turbo model is optimized for **10-30 second** audio chunks. This implementation provides two intelligent chunking strategies to handle longer recordings without losing information.

## Chunking Strategies

### 1. Simple (Default)

**When to use**: Short recordings under 30 seconds

**How it works**:
- Records entire audio
- Sends to Groq when recording stops
- No chunking, no splitting

**Pros**:
- Simplest implementation
- Lowest overhead
- Best for quick transcriptions

**Cons**:
- Not suitable for long recordings
- May exceed optimal duration

**Example**:
```ts
const stt = createSTTService();
await stt.connect({
  provider: 'groq-whisper',
  apiKey: 'your-key',
  chunkingStrategy: 'simple', // default
}, callbacks);
```

---

### 2. VAD-Based Chunking

**When to use**: Long recordings requiring maximum accuracy

**How it works**:
1. Uses `@ricky0123/vad-web` for precise voice activity detection
2. Detects speech start/end using ML model
3. Accumulates speech segments (silence is discarded)
4. Sends to API when:
   - 10+ seconds of speech accumulated AND silence is detected
5. Converts VAD output (Float32Array) to WAV format
6. Sends to Groq API
7. Accumulates all transcripts

**Technical Details**:
- Uses Silero VAD model (loaded from CDN)
- Fallback to simple if VAD unavailable
- Processes audio at 16kHz
- Only sends speech chunks, silence is discarded

**Pros**:
- Most accurate speech detection
- Best for noisy environments
- Handles complex audio scenarios
- ML-based, not just volume threshold

**Cons**:
- Requires external library (@ricky0123/vad-web)
- Slightly higher CPU usage
- Needs VAD loaded in index.html

**Requirements**:
Add to `index.html`:
```html
<script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.7/dist/bundle.min.js"></script>
```

**Example**:
```ts
await stt.connect({
  provider: 'groq-whisper',
  apiKey: 'your-key',
  chunkingStrategy: 'vad',
}, {
  onTranscript: (transcript) => {
    // transcript.text contains accumulated result
    console.log('Full transcript so far:', transcript.text);
  },
});
```

---

## Constraints

VAD-based chunking respects this constraint:

| Constraint | Value | Description |
|------------|-------|-------------|
| **Minimum** | 10 seconds | Never send chunks shorter than this (accumulated speech only) |

## How Transcripts Are Accumulated

**All strategies maintain a running transcript**:

1. Each chunk is transcribed separately
2. Results are concatenated in order
3. `onTranscript` receives accumulated text
4. `isFinal: false` during recording
5. `isFinal: true` when recording stops

**Example flow**:
```
Chunk 1 (30s): "Hello how are you"
  → onTranscript({ text: "Hello how are you", isFinal: false })

Chunk 2 (30s): "I am doing great"
  → onTranscript({ text: "Hello how are you I am doing great", isFinal: false })

Chunk 3 (20s): "Thanks for asking"
  → onTranscript({ text: "Hello how are you I am doing great Thanks for asking", isFinal: false })

Recording stops:
  → onTranscript({ text: "Hello how are you I am doing great Thanks for asking", isFinal: true })
```

## Queue Management

**Background Processing**:
- Chunks are queued and processed sequentially
- Transcription happens in background
- Doesn't block recording
- Guarantees order preservation

**Error Handling**:
- Failed chunks are logged
- Processing continues with next chunk
- Full transcript still contains successful chunks

## Performance Considerations

### Simple
- **CPU**: Minimal
- **Memory**: Low (one MediaRecorder)
- **Network**: One API call per recording

### VAD-Based
- **CPU**: Medium (~5-10% for VAD model)
- **Memory**: High (VAD model + audio buffers)
- **Network**: Multiple API calls (one per 10+ seconds of speech)

## Choosing a Strategy

```
Recording Duration          Recommended Strategy
─────────────────────────────────────────────────
< 30 seconds               → Simple
> 30 seconds               → VAD-based
Noisy environment          → VAD-based
Maximum accuracy needed    → VAD-based
```

## Complete Example

```tsx
import { useSTT } from '@/services/stt/useSTT';

function LongFormRecorder() {
  const [strategy, setStrategy] = useState<'simple' | 'vad'>('vad');

  const stt = useSTT({
    config: {
      provider: 'groq-whisper',
      apiKey: process.env.GROQ_API_KEY!,
      chunkingStrategy: strategy,
    },
  });

  return (
    <div>
      {/* Strategy selector */}
      <select value={strategy} onChange={(e) => setStrategy(e.target.value as any)}>
        <option value="simple">Simple</option>
        <option value="vad">VAD-based</option>
      </select>

      {/* Recording controls */}
      <button onClick={stt.connect}>Connect</button>
      <button onClick={stt.startRecording}>Start</button>
      <button onClick={stt.stopRecording}>Stop</button>

      {/* Accumulated transcript */}
      <div>
        <h3>Transcript:</h3>
        <p>{stt.transcript}</p>
        {stt.error && <div>Error: {stt.error.message}</div>}
      </div>
    </div>
  );
}
```

## Troubleshooting

**VAD not working**:
- Check if `@ricky0123/vad-web` is loaded in index.html
- Open console, check for `window.vad`
- System will auto-fallback to simple

**Chunks too small/large**:
- Adjust `CHUNK_MIN_DURATION` constant in provider
- VAD automatically handles speech detection

**Transcript incomplete**:
- Check network tab for failed API calls
- Look for errors in `onError` callback
- Verify queue is processing (check logs)

**Performance issues**:
- Use Simple for short recordings
- Reduce VAD model quality if available
- Increase chunk duration thresholds

## Architecture

```
┌─────────────────────────────────────────────────┐
│  GroqWhisperProvider                            │
├─────────────────────────────────────────────────┤
│                                                 │
│  Strategy Selection                             │
│  ┌─────────┬──────────────┐                    │
│  │ Simple  │  VAD-based   │                    │
│  └─────────┴──────────────┘                    │
│                                                 │
│  Audio Collection                               │
│  ┌────────────────────────────────────────┐    │
│  │ MediaRecorder → Blob chunks            │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  VAD Monitoring                                 │
│  ┌────────────────────────────────────────┐    │
│  │ VAD → Speech Detection → Accumulation  │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  Queue Management                               │
│  ┌────────────────────────────────────────┐    │
│  │ Chunk Queue → Sequential Processing    │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  Transcription                                  │
│  ┌────────────────────────────────────────┐    │
│  │ Blob → FormData → Groq API → Text      │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  Accumulation                                   │
│  ┌────────────────────────────────────────┐    │
│  │ fullTranscript += newText               │    │
│  │ onTranscript(fullTranscript, isFinal)   │    │
│  └────────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Summary

✅ **No information loss** - All chunks are transcribed and accumulated
✅ **Smart splitting** - VAD never cuts during speech
✅ **Automatic handling** - User doesn't need to manage chunks
✅ **Final transcript** - Always returns complete accumulated result
✅ **Configurable** - Two strategies for different use cases
✅ **Robust** - Queue management and error handling
✅ **Self-contained** - All logic in provider, transparent to user

The module user just calls `startRecording()` and `stopRecording()` - everything else is handled automatically!
