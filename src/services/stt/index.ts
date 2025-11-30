/**
 * STT Module (Singleton)
 *
 * Barrel export for the Speech-to-Text service
 */

export { STTService, getSTTService } from './STTService';
export type {
  STTProvider,
  STTConfig,
  STTTranscript,
  STTError,
  STTConnectionStatus,
  STTTranscriptCallback,
  STTErrorCallback,
  STTStatusCallback,
  STTServiceCallbacks,
  ISTTProvider,
} from './types';
