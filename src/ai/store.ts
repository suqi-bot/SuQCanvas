import { create } from 'zustand'
import type { AiTask } from './taskTypes'

const STORAGE = 'suqcanvas-ai-settings-v1'
const defaults = { provider: 'comfy', comfyUrl: 'http://127.0.0.1:8188', cloudUrl: '', model: '',
  llmUrl: '', llmModel: '', size: '1024x1024', workflow: '', binding: '', randomSeed: true }
export type AiSettings = typeof defaults
function loadSettings(): AiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
      [key, typeof stored[key] === typeof value ? stored[key] : value])) as AiSettings
  } catch { return { ...defaults } }
}

interface AiState {
  settings: AiSettings
  comfyKey: string
  cloudKey: string
  llmKey: string
  settingsOpen: boolean
  jobs: Record<string, { message: string; error?: string; running: boolean }>
  tasks: AiTask[]
  setTask: (task: AiTask) => void
  setSettings: (settings: Partial<AiSettings>) => void
  setCredentials: (credentials: Partial<Pick<AiState, 'comfyKey' | 'cloudKey' | 'llmKey'>>) => void
  setSettingsOpen: (open: boolean) => void
  setJob: (id: string, job: AiState['jobs'][string]) => void
}

// Credentials and active jobs are deliberately memory-only, independent of any popup lifetime.
export const useAiStore = create<AiState>((set) => ({
  settings: loadSettings(), comfyKey: '', cloudKey: '', llmKey: '', settingsOpen: false, jobs: {}, tasks: [],
  setTask: (task) => set((s) => ({ tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)] })),
  setSettings: (settings) => set((s) => ({ settings: { ...s.settings, ...settings } })),
  setCredentials: (credentials) => set(credentials),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setJob: (id, job) => set((s) => ({ jobs: { ...s.jobs, [id]: job } })),
}))

export function saveAiSettings() {
  localStorage.setItem(STORAGE, JSON.stringify(useAiStore.getState().settings))
}
