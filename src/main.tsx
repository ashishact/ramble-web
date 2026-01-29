import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App.tsx'
import { rambleNative } from './services/stt/rambleNative'
import { startBackupScheduler } from './db/backup'
import { initializeDatabase } from './db'
import { getCurrentProfile } from './lib/profile'
import './lib/debugUtils' // Initialize window.ramble debug utilities

// Initialize database for the current profile (based on URL)
const profile = getCurrentProfile()
initializeDatabase(profile)
console.log(`[App] Starting with profile: ${profile}`)

// Connect to Ramble native app (maintains persistent WebSocket connection)
rambleNative.connect()

// Start hourly database backup scheduler
startBackupScheduler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
