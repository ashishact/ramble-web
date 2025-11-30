# STT Service

A modular, provider-agnostic Speech-to-Text library for React applications.

## Features

- ✅ **Singleton Architecture**: WebSocket and audio connections live outside React
- ✅ **Multiple Providers**: Groq Whisper, Deepgram Nova, Deepgram Flux
- ✅ **Two Modes**: Integrated (mic + transcription) or Headless (audio stream → transcript)
- ✅ **Type-Safe**: Full TypeScript support
- ✅ **React Hook**: Easy integration with `useSTT` hook
- ✅ **Real-time**: Streaming transcription with interim results
- ✅ **Re-render Safe**: No reconnections on component re-renders
- ✅ **Self-contained**: Handles WebSocket connections and audio processing internally

## Quick Start

### Using the React Hook (Recommended)

```tsx
import { useSTT } from '@/services/stt/useSTT';

function MyComponent() {
  const stt = useSTT({
    config: {
      provider: 'deepgram-flux',
      apiKey: 'your-api-key',
    },
    autoConnect: true,
  });

  return (
    <div>
      <button onClick={stt.startRecording} disabled={stt.isRecording}>
        Start
      </button>
      <button onClick={stt.stopRecording} disabled={!stt.isRecording}>
        Stop
      </button>
      <p>{stt.transcript}</p>
      {stt.error && <div>Error: {stt.error.message}</div>}
    </div>
  );
}
```

### Using the Service Directly (Singleton)

```ts
import { getSTTService } from '@/services/stt';

// Get the singleton instance
const stt = getSTTService();

// Connect
await stt.connect(
  {
    provider: 'deepgram-nova',
    apiKey: 'your-api-key',
  },
  {
    onTranscript: (transcript) => {
      console.log('Transcript:', transcript.text);
      console.log('Is final:', transcript.isFinal);
    },
    onError: (error) => {
      console.error('Error:', error.message);
    },
    onStatusChange: (status) => {
      console.log('Status:', status);
    },
  }
);

// Integrated mode: Use microphone
await stt.startRecording();
// ... speak ...
stt.stopRecording();

// Headless mode: Send external audio
const audioData = getAudioFromSomewhere();
stt.sendAudio(audioData);

// Disconnect
stt.disconnect();
```

## Providers

### Groq Whisper

Fast, file-based transcription using Groq's Whisper API.

```ts
{
  provider: 'groq-whisper',
  apiKey: 'your-groq-api-key',
  model: 'whisper-large-v3-turbo', // optional
}
```

**Note**: Groq Whisper is not real-time streaming. Transcription happens after recording stops.

### Deepgram Nova (v1)

Real-time streaming with Nova-3 model.

```ts
{
  provider: 'deepgram-nova',
  apiKey: 'your-deepgram-api-key',
  model: 'nova-3', // optional
  sampleRate: 16000, // optional
}
```

### Deepgram Flux (v2)

Advanced conversational AI with turn detection.

```ts
{
  provider: 'deepgram-flux',
  apiKey: 'your-deepgram-api-key',
  model: 'flux-general-en', // optional
  sampleRate: 16000, // optional
}
```

## Two Usage Modes

### 1. Integrated Mode (Microphone + Transcription)

The service handles both microphone access and transcription:

```ts
await stt.connect(config, callbacks);
await stt.startRecording(); // Requests mic access and starts transcribing
stt.stopRecording(); // Stops mic and transcription
```

### 2. Headless Mode (External Audio → Transcription)

You manage the audio source, the service just handles transcription:

```ts
await stt.connect(config, callbacks);

// Your audio processing
const mediaRecorder = new MediaRecorder(stream);
mediaRecorder.ondataavailable = (event) => {
  stt.sendAudio(event.data); // Send audio chunks
};
```

## API Reference

### `createSTTService()`

Creates a new STT service instance.

### `STTService.connect(config, callbacks)`

Connects to an STT provider.

**Parameters:**
- `config: STTConfig` - Provider configuration
- `callbacks: STTServiceCallbacks` - Event callbacks

**Returns:** `Promise<void>`

### `STTService.disconnect()`

Disconnects from the provider and cleans up resources.

### `STTService.startRecording()`

Starts microphone recording and transcription (integrated mode).

**Returns:** `Promise<void>`

### `STTService.stopRecording()`

Stops recording.

### `STTService.sendAudio(audioData)`

Sends audio data for transcription (headless mode).

**Parameters:**
- `audioData: ArrayBuffer | Blob` - Audio data to transcribe

### `STTService.isConnected()`

Returns the connection status.

**Returns:** `boolean`

### `STTService.isRecording()`

Returns the recording status.

**Returns:** `boolean`

### `STTService.getProvider()`

Returns the current provider.

**Returns:** `STTProvider | null`

## Types

### `STTConfig`

```ts
interface STTConfig {
  provider: 'groq-whisper' | 'deepgram-nova' | 'deepgram-flux';
  apiKey: string;
  language?: string;
  model?: string;
  sampleRate?: number;
  encoding?: string;
}
```

### `STTTranscript`

```ts
interface STTTranscript {
  text: string;
  isFinal: boolean;
  confidence?: number;
  timestamp?: number;
}
```

### `STTServiceCallbacks`

```ts
interface STTServiceCallbacks {
  onTranscript?: (transcript: STTTranscript) => void;
  onError?: (error: STTError) => void;
  onStatusChange?: (status: STTConnectionStatus) => void;
}
```

## Examples

### Example 1: Simple Recording

```tsx
const stt = useSTT({
  config: { provider: 'deepgram-flux', apiKey: 'xxx' },
});

<button onClick={stt.connect}>Connect</button>
<button onClick={stt.startRecording}>Record</button>
<button onClick={stt.stopRecording}>Stop</button>
<p>{stt.transcript}</p>
```

### Example 2: External Audio Source

```ts
const stt = createSTTService();

await stt.connect(config, {
  onTranscript: (t) => console.log(t.text),
});

// From MediaRecorder
const recorder = new MediaRecorder(stream);
recorder.ondataavailable = (e) => stt.sendAudio(e.data);

// From AudioContext
const audioContext = new AudioContext();
// ... process audio ...
stt.sendAudio(pcmBuffer);
```

### Example 3: Multiple Providers

```ts
// Switch providers dynamically
const config1 = { provider: 'deepgram-nova', apiKey: 'xxx' };
const config2 = { provider: 'groq-whisper', apiKey: 'yyy' };

await stt.connect(config1, callbacks);
// ... use Deepgram ...
stt.disconnect();

await stt.connect(config2, callbacks);
// ... use Groq ...
```

## Architecture

```
src/services/stt/
├── index.ts                    # Barrel export
├── types.ts                    # Type definitions
├── STTService.ts              # Main service class
├── useSTT.ts                  # React hook
├── providers/
│   ├── DeepgramProvider.ts    # Deepgram implementation
│   └── GroqWhisperProvider.ts # Groq implementation
└── README.md                  # This file
```

## Error Handling

All errors are delivered through the `onError` callback:

```ts
{
  code: 'CONNECTION_ERROR' | 'PARSE_ERROR' | 'MICROPHONE_ERROR' | ...,
  message: 'Human-readable error message',
  provider: 'deepgram-flux',
}
```

## Best Practices

1. **Always disconnect**: Call `disconnect()` when done to clean up resources
2. **Handle errors**: Implement `onError` callback for robust error handling
3. **Use the hook**: Prefer `useSTT` hook in React components for automatic cleanup
4. **Check status**: Use `isConnected()` and `isRecording()` before calling methods
5. **Choose the right mode**: Use integrated mode for simple cases, headless for complex audio pipelines

## License

Part of the webvoiceagent project.
