import { create } from 'zustand'
import type { AiTask } from './taskTypes'
import { loadCredentialsSync, saveCredentials, hydrateCredentials } from './credentials'

const STORAGE = 'suqcanvas-ai-settings-v1'
const defaults = { provider: 'comfy', comfyUrl: 'http://127.0.0.1:8188', cloudUrl: '', model: '',
  llmUrl: '', llmModel: '', size: '1024x1024', workflow: '', binding: '', negativeBinding: '', negativePrompt: '', randomSeed: true,
  splitWorkflow: '', splitImageBinding: '', splitPromptBinding: '', splitNegativeBinding: '',
  splitProvider: 'comfy', splitCloudUrl: '', splitModel: '', splitCount: 2 }
export type AiSettings = typeof defaults
function loadSettings(): AiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
      [key, typeof stored[key] === typeof value ? stored[key] : value])) as AiSettings
  } catch { return { ...defaults } }
}

export function splitCount(value: number): number {
  return Math.min(4, Math.max(1, Math.floor(value) || 1))
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

const initialCredentials = loadCredentialsSync()

function persistSettings(settings: AiSettings) {
  try { localStorage.setItem(STORAGE, JSON.stringify(settings)) } catch { /* ignore */ }
}

// Settings stay in suqcanvas-ai-settings-v1; API keys live in a dedicated credentials store/file.
export const useAiStore = create<AiState>((set, get) => ({
  settings: loadSettings(), ...initialCredentials, settingsOpen: false, jobs: {}, tasks: [],
  setTask: (task) => set((s) => ({ tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)] })),
  setSettings: (settings) => set((s) => {
    const next = { ...s.settings, ...settings }
    persistSettings(next)
    return { settings: next }
  }),
  setCredentials: (credentials) => {
    set(credentials)
    const { comfyKey, cloudKey, llmKey } = get()
    void saveCredentials({ comfyKey, cloudKey, llmKey })
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setJob: (id, job) => set((s) => ({ jobs: { ...s.jobs, [id]: job } })),
}))

/** 应用启动后从独立文件恢复 Key；不会用空值覆盖已填内容。 */
export async function hydrateAiCredentials(): Promise<void> {
  try {
    const credentials = await hydrateCredentials()
    const state = useAiStore.getState()
    useAiStore.setState({
      comfyKey: state.comfyKey || credentials.comfyKey,
      cloudKey: state.cloudKey || credentials.cloudKey,
      llmKey: state.llmKey || credentials.llmKey,
    })
  } catch {
    /* ignore */
  }
}

export function saveAiSettings() {
  persistSettings(useAiStore.getState().settings)
  const { comfyKey, cloudKey, llmKey } = useAiStore.getState()
  void saveCredentials({ comfyKey, cloudKey, llmKey })
}
