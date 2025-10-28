# Gemini Live Voice Frontend

React + TypeScript + Vite frontend for Gemini Live voice conversations.

## Features

- 🎤 Browser-based audio recording using MediaRecorder API
- 🔊 Real-time audio playback using Web Audio API
- 🔌 WebSocket connection to NestJS backend gateway
- 🎨 Beautiful UI with Tailwind CSS v4
- ⚡ Fast development with Vite

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The app will be available at `http://localhost:5173`

## How It Works

1. **Audio Recording**: Captures microphone input at 16kHz, 16-bit PCM mono
2. **WebSocket Communication**: Sends audio chunks to backend gateway via Socket.IO
3. **Audio Playback**: Receives audio responses from Gemini and plays them at 24kHz

## Architecture

- **Browser → Backend**: Audio data (base64 encoded PCM)
- **Backend → Gemini**: Forward audio to Gemini Live API
- **Gemini → Backend → Browser**: AI audio responses

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS v4
- Socket.IO Client
- Web Audio API
