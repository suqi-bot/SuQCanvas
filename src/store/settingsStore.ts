import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'suqcanvas:theme'

interface SettingsState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}
const initial: Theme =
  (() => {
    try {
      const param = new URLSearchParams(window.location.search).get('theme')
      if (param === 'light' || param === 'dark') return param
      if (localStorage.getItem(STORAGE_KEY) === 'light') return 'light'
    } catch {
      // ignore
    }
    return 'dark'
  })()
applyTheme(initial)

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  },
}))
