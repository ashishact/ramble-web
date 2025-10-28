import { useRef, useCallback } from 'react';

export const useAudioPlayer = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const pausedQueueRef = useRef<AudioBuffer[]>([]); // Store paused audio
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isInterruptedRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null); // Track current response session

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const playAudio = useCallback(async (base64Audio: string, sessionId?: string) => {
    try {
      // Gemini: Use Web Audio API with PCM conversion
      const audioContext = initAudioContext();

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Manual PCM conversion for Gemini
      const evenLength = bytes.length - (bytes.length % 2);
      const evenBytes = bytes.slice(0, evenLength);
      const pcmData = new Int16Array(evenBytes.buffer, evenBytes.byteOffset, evenLength / 2);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7fff);
      }
      const audioBuffer = audioContext.createBuffer(1, floatData.length, 24000);
      audioBuffer.copyToChannel(floatData, 0);

      // Check if this is a new response session (different session ID)
      const isNewSession = sessionId && sessionId !== currentSessionIdRef.current;

      if (isNewSession) {
        console.log(`[Audio] New response session: ${sessionId} (previous: ${currentSessionIdRef.current})`);
        console.log('[Audio] Clearing old audio queue for new response');

        // Clear old audio from previous response
        audioQueueRef.current = [];
        pausedQueueRef.current = [];
        isInterruptedRef.current = false;

        // Update session ID
        currentSessionIdRef.current = sessionId;
      }

      // Add to queue
      audioQueueRef.current.push(audioBuffer);

      // Start playback if not already playing and not interrupted
      if (!isPlayingRef.current && !isInterruptedRef.current) {
        playNextInQueue();
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }, []);

  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    if (isInterruptedRef.current) {
      // User is speaking, don't play
      return;
    }

    isPlayingRef.current = true;
    const audioContext = audioContextRef.current!;
    const buffer = audioQueueRef.current.shift()!;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    currentSourceRef.current = source;

    source.onended = () => {
      currentSourceRef.current = null;
      playNextInQueue();
    };

    source.start();
  }, []);

  const pauseAudio = useCallback(() => {
    console.log('[Audio] Pausing audio - user is speaking');

    // Stop current playing audio
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }

    // Move current queue to paused queue
    pausedQueueRef.current = [...audioQueueRef.current];
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isInterruptedRef.current = true;
  }, []);

  const resumeAudio = useCallback(() => {
    console.log('[Audio] Resuming audio - user stopped speaking');

    isInterruptedRef.current = false;

    // Restore paused queue if no new audio has arrived
    if (audioQueueRef.current.length === 0 && pausedQueueRef.current.length > 0) {
      console.log('[Audio] Restoring paused audio queue');
      audioQueueRef.current = [...pausedQueueRef.current];
      pausedQueueRef.current = [];
    }

    // Start playing
    if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
      playNextInQueue();
    }
  }, []);

  const stopAudio = useCallback(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    audioQueueRef.current = [];
    pausedQueueRef.current = [];
    isPlayingRef.current = false;
    isInterruptedRef.current = false;
    currentSessionIdRef.current = null;
  }, []);

  return {
    playAudio,
    stopAudio,
    pauseAudio,
    resumeAudio,
  };
};
