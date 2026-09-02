import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'suqcanvas:theme'
const GUIDES_KEY = 'suqcanvas:guides'

interface SettingsState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** 拖动节点时是否启用对齐参考线（智能吸附）。 */
  showAlignmentGuides: boolean
  setShowAlignmentGuides: (show: boolean) => void
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

const initialGuides: boolean = (() => {
  try {
    const raw = localStorage.getItem(GUIDES_KEY)
    if (raw === '0' || raw === 'false') return false
  } catch {
    // ignore
  }
  // 默认开启，提供更好的拖拽对齐体验。
  return true
})()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: initial,
  showAlignmentGuides: initialGuides,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  },
  setShowAlignmentGuides: (show) => {
    try {
      localStorage.setItem(GUIDES_KEY, show ? '1' : '0')
    } catch {
      // ignore
    }
    set({ showAlignmentGuides: show })
  },
}))
