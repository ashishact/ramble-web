import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App.tsx'
import { rambleChecker } from './services/stt/rambleChecker'
import { startBackupScheduler } from './db/backup'
import { initializeDatabase } from './db'
import { getCurrentProfile } from './lib/profile'

// Initialize database for the current profile (based on URL)
const profile = getCurrentProfile()
initializeDatabase(profile)
console.log(`[App] Starting with profile: ${profile}`)

// Check for Ramble availability on app load
rambleChecker.checkAvailability()

// Start hourly database backup scheduler
startBackupScheduler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
