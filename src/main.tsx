import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { hydrateAiCredentials } from './ai/store'

// Restore AI API keys from the dedicated credentials file/store before interactions need them.
void hydrateAiCredentials()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
