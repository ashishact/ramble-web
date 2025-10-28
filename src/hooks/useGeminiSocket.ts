import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export const useGeminiSocket = (agent?: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const onMessageCallbackRef = useRef<((message: any) => void) | null>(null);

  useEffect(() => {
    // Connect to backend WebSocket with agent query parameter
    const socket = io('http://localhost:3000', {
      transports: ['websocket'],
      query: agent ? { agent } : {},
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to backend');
      setIsConnected(true);
    });

    socket.on('connected', (data) => {
      console.log('Connected with client ID:', data.clientId, 'Agent:', data.agent || 'default');
    });

    socket.on('gemini-message', (message) => {
      console.log('Received from Gemini:', message);
      if (onMessageCallbackRef.current) {
        onMessageCallbackRef.current(message);
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from backend');
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [agent]);

  const sendAudioData = (audioData: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('audio-data', { audio: audioData });
    }
  };

  const sendTextMessage = (text: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('text-message', { text });
      console.log('Sent text message:', text);
    }
  };

  const onMessage = (callback: (message: any) => void) => {
    onMessageCallbackRef.current = callback;
  };

  return {
    isConnected,
    sendAudioData,
    sendTextMessage,
    onMessage,
  };
};
