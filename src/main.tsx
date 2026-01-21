import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App.tsx'
import { rambleChecker } from './services/stt/rambleChecker'
import { startBackupScheduler } from './db/backup'

// Check for Ramble availability on app load
rambleChecker.checkAvailability()

// Start hourly database backup scheduler
startBackupScheduler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
