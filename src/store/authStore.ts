import { create } from 'zustand'
import type { AuthError, User } from '@supabase/supabase-js'
import { supabase } from '../sync/supabaseClient'
import { db } from '../db/db'
import { IS_LAN_BUILD } from '../buildMode'
import { useProjectStore } from './projectStore'
import { useCanvasStore } from './canvasStore'

interface AuthState {
  user: User | null
  guest: boolean
  loading: boolean
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  enterGuest: () => void
}

function translateAuthError(err: AuthError): string {
  const msg = err.message
  if (msg.includes('Invalid login credentials')) return '邮箱或密码错误'
  if (msg.includes('Email not confirmed')) return '邮箱尚未验证，请先查收验证邮件'
  if (msg.includes('User not allowed')) return '该账号无权登录'
  if (msg.includes('rate limit')) return '操作过于频繁，请稍后再试'
  return msg
}

let listenerInstalled = false

const GUEST_KEY = 'sq:guest'

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  guest: false,
  loading: true,

  init: async () => {
    const persistedGuest = localStorage.getItem(GUEST_KEY) === '1'
    if (!supabase) {
      let hasLanProfile = false
      if (IS_LAN_BUILD) {
        try {
          const saved = JSON.parse(localStorage.getItem('sq:lan') ?? '{}') as {
            url?: string
            name?: string
          }
          hasLanProfile = Boolean(saved.url?.trim() && saved.name?.trim())
        } catch {
          // 无效配置按首次进入处理
        }
      }
      set({ guest: IS_LAN_BUILD ? hasLanProfile : persistedGuest, loading: false })
      return
    }
    if (!listenerInstalled) {
      listenerInstalled = true
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ user: session?.user ?? null, loading: false })
      })
    }
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user ?? null
    set({ user, guest: user ? false : persistedGuest, loading: false })
  },

  signIn: async (email, password) => {
    if (!supabase) return '未配置 Supabase，无法登录'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? translateAuthError(error) : null
  },

  signOut: async () => {
    const wasGuest = get().guest
    if (supabase) await supabase.auth.signOut()
    // 只有退出真实云账号时才清理本地缓存（避免不同账号间数据串入云端）；
    // 退出局域网/游客模式时保留本地项目，防止数据丢失
    if (!wasGuest) {
      await db.projects.clear()
      await db.assets.clear()
    }
    useProjectStore.setState({
      projectId: null,
      projectName: '未命名项目',
      loaded: false,
      initialized: false,
      saveStatus: 'idle',
    })
    useCanvasStore.getState().reset()
    useCanvasStore.getState().clearHistory()
    localStorage.removeItem(GUEST_KEY)
    set({ user: null, guest: false })
  },

  enterGuest: () => {
    localStorage.setItem(GUEST_KEY, '1')
    set({ guest: true, loading: false })
  },
}))
