/**
 * STT Service Usage Examples
 *
 * This file contains examples of how to use the STT service
 * in various scenarios. Copy and adapt these patterns as needed.
 */

import { getSTTService } from './STTService';
import type { STTConfig } from './types';

// ============================================================================
// Example 1: Simple Recording with Deepgram Flux
// ============================================================================

export async function example1_SimpleRecording() {
  const stt = getSTTService();

  await stt.connect(
    {
      provider: 'deepgram-flux',
      apiKey: 'your-deepgram-api-key',
    },
    {
      onTranscript: (transcript) => {
        console.log('Transcript:', transcript.text);
        if (transcript.isFinal) {
          console.log('✓ Final');
        }
      },
      onError: (error) => {
        console.error('Error:', error.message);
      },
      onStatusChange: (status) => {
        console.log('Status:', status);
      },
    }
  );

  // Start recording from microphone
  await stt.startRecording();

  // ... user speaks ...

  // Stop recording
  stt.stopRecording();

  // Disconnect when done
  stt.disconnect();
}

// ============================================================================
// Example 2: Headless Mode - External Audio Source
// ============================================================================

export async function example2_HeadlessMode() {
  const stt = getSTTService();

  // Connect without starting recording
  await stt.connect(
    {
      provider: 'deepgram-nova',
      apiKey: 'your-deepgram-api-key',
    },
    {
      onTranscript: (transcript) => {
        console.log('Transcript:', transcript.text);
      },
    }
  );

  // Your custom audio pipeline
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);

    // Convert to PCM16
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Send to STT service
    stt.sendAudio(pcmData.buffer);
  };

  // Cleanup
  // processor.disconnect();
  // source.disconnect();
  // audioContext.close();
  // stt.disconnect();
}

// ============================================================================
// Example 3: Switch Between Providers
// ============================================================================

export async function example3_SwitchProviders() {
  const stt = getSTTService();

  // Start with Groq Whisper
  await stt.connect(
    {
      provider: 'groq-whisper',
      apiKey: 'groq-key',
    },
    {
      onTranscript: (t) => console.log('Groq:', t.text),
    }
  );

  await stt.startRecording();
  stt.stopRecording();

  // Switch to Deepgram
  stt.disconnect();

  await stt.connect(
    {
      provider: 'deepgram-flux',
      apiKey: 'deepgram-key',
    },
    {
      onTranscript: (t) => console.log('Deepgram:', t.text),
    }
  );

  await stt.startRecording();
  stt.stopRecording();

  stt.disconnect();
}

// ============================================================================
// Example 4: File Upload Transcription (Groq Whisper)
// ============================================================================

export async function example4_FileUpload(audioFile: File) {
  const stt = getSTTService();

  await stt.connect(
    {
      provider: 'groq-whisper',
      apiKey: 'your-groq-api-key',
    },
    {
      onTranscript: (transcript) => {
        console.log('Transcription complete:', transcript.text);
      },
      onError: (error) => {
        console.error('Transcription failed:', error);
      },
    }
  );

  // Send the file directly
  stt.sendAudio(audioFile);

  // Wait for response (async)
  // The onTranscript callback will be called when done
}

// ============================================================================
// Example 5: React Component Integration (TypeScript)
// ============================================================================

/*
import { useSTT } from '@/services/stt/useSTT';

function MyVoiceComponent() {
  const stt = useSTT({
    config: {
      provider: 'deepgram-flux',
      apiKey: process.env.REACT_APP_DEEPGRAM_KEY!,
    },
    autoConnect: true, // Auto-connect on mount
  });

  return (
    <div>
      <button onClick={stt.startRecording} disabled={stt.isRecording}>
        Start
      </button>
      <button onClick={stt.stopRecording} disabled={!stt.isRecording}>
        Stop
      </button>

      <p>Status: {stt.isConnected ? 'Connected' : 'Disconnected'}</p>
      <p>Recording: {stt.isRecording ? 'Yes' : 'No'}</p>

      {stt.error && <div>Error: {stt.error.message}</div>}

      <div>
        <h3>Transcript:</h3>
        <p>{stt.transcript}</p>
      </div>

      <button onClick={stt.clearTranscript}>Clear</button>
    </div>
  );
}
*/

// ============================================================================
// Example 6: Advanced - Custom Audio Processing
// ============================================================================

export async function example6_CustomAudioProcessing() {
  const stt = getSTTService();

  await stt.connect(
    {
      provider: 'deepgram-nova',
      apiKey: 'your-key',
      sampleRate: 16000,
    },
    {
      onTranscript: (t) => console.log(t.text),
    }
  );

  // Custom MediaRecorder with specific format
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
  });

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      // Convert webm to PCM if needed, or send directly
      stt.sendAudio(event.data);
    }
  };

  mediaRecorder.start(250); // Send chunks every 250ms

  // Stop later
  // mediaRecorder.stop();
  // stt.disconnect();
}

// ============================================================================
// Example 7: Error Handling and Retry Logic
// ============================================================================

export async function example7_ErrorHandlingWithRetry() {
  const stt = getSTTService();
  let retryCount = 0;
  const maxRetries = 3;

  const connect = async () => {
    try {
      await stt.connect(
        {
          provider: 'deepgram-flux',
          apiKey: 'your-key',
        },
        {
          onTranscript: (t) => console.log(t.text),
          onError: async (error) => {
            console.error('Error:', error);

            if (error.code === 'CONNECTION_ERROR' && retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying... (${retryCount}/${maxRetries})`);
              setTimeout(() => connect(), 2000);
            }
          },
        }
      );

      console.log('Connected successfully');
      retryCount = 0;
    } catch (err) {
      console.error('Failed to connect:', err);

      if (retryCount < maxRetries) {
        retryCount++;
        console.log(`Retrying... (${retryCount}/${maxRetries})`);
        setTimeout(() => connect(), 2000);
      }
    }
  };

  await connect();
}

// ============================================================================
// Example 8: Multi-Provider Configuration
// ============================================================================

export class MultiProviderSTT {
  private configs: Record<string, STTConfig> = {
    fast: {
      provider: 'groq-whisper',
      apiKey: 'groq-key',
    },
    accurate: {
      provider: 'deepgram-nova',
      apiKey: 'deepgram-key',
    },
    conversational: {
      provider: 'deepgram-flux',
      apiKey: 'deepgram-key',
    },
  };

  private stt = getSTTService();

  async useProvider(name: keyof typeof this.configs) {
    const config = this.configs[name];
    if (!config) {
      throw new Error(`Unknown provider: ${name}`);
    }

    await this.stt.connect(config, {
      onTranscript: (t) => console.log(`[${name}]:`, t.text),
      onError: (e) => console.error(`[${name}]:`, e),
    });

    return this.stt;
  }

  disconnect() {
    this.stt.disconnect();
  }
}

/*
// Usage:
const multiSTT = new MultiProviderSTT();

// Use Groq for quick transcription
await multiSTT.useProvider('fast');
await stt.startRecording();
stt.stopRecording();
multiSTT.disconnect();

// Switch to Deepgram for accurate streaming
await multiSTT.useProvider('accurate');
await stt.startRecording();
// ...
*/
