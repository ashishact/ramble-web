import { useState, useRef, useCallback } from 'react';

export const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const shouldSendRef = useRef<(() => boolean) | null>(null);

  const startRecording = useCallback(
    async (onData: (data: string) => void, shouldSendCheck?: () => boolean) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        streamRef.current = stream;
        onDataCallbackRef.current = onData;
        shouldSendRef.current = shouldSendCheck || null;

        // Create audio context for processing
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const processor = audioContextRef.current.createScriptProcessor(
          4096,
          1,
          1,
        );

        processor.onaudioprocess = (e) => {
          // Check if we should send audio (based on VAD inactivity timeout)
          if (shouldSendRef.current && !shouldSendRef.current()) {
            // Don't process or send audio if inactive
            return;
          }

          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 to Int16 PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Convert to base64
          const base64 = btoa(
            String.fromCharCode(...new Uint8Array(pcmData.buffer)),
          );

          if (onDataCallbackRef.current) {
            onDataCallbackRef.current(base64);
          }
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);

        setIsRecording(true);
      } catch (error) {
        console.error('Error starting recording:', error);
        throw error;
      }
    },
    [],
  );

  const stopRecording = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    onDataCallbackRef.current = null;
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
};
