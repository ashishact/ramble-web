/**
 * Hooks - React hooks for voice agent functionality
 */

export { useAudioRecorder } from './useAudioRecorder';
export { useAudioPlayer } from './useAudioPlayer';
export { useVoiceAgent, type UseVoiceAgentReturn } from './useVoiceAgent';

// STT Service
export { useSTT } from '../services/stt/useSTT';
export type { UseSTTOptions, UseSTTReturn } from '../services/stt/useSTT';
