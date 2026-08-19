import { create } from 'zustand'
import type { AuthError, User } from '@supabase/supabase-js'
import { supabase } from '../sync/supabaseClient'
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

/** 重置项目/画布状态，使下次进入时按当前登录态重新初始化（防止云端/本地数据串写） */
function resetProjectState(): void {
  useProjectStore.setState({
    projectId: null,
    projectName: '未命名项目',
    loaded: false,
    initialized: false,
    saveStatus: 'idle',
  })
  useCanvasStore.getState().reset()
  useCanvasStore.getState().clearHistory()
}

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
        const wasGuest = get().guest
        set({
          user: session?.user ?? null,
          guest: session?.user ? false : get().guest,
          loading: false,
        })
        if (session?.user && wasGuest) resetProjectState()
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
    if (supabase) await supabase.auth.signOut()
    // 本地数据与云端相互独立：云端用户不写本地项目，游客/本地数据永不因登录或退出而改动
    resetProjectState()
    localStorage.removeItem(GUEST_KEY)
    set({ user: null, guest: false })
  },

  enterGuest: () => {
    localStorage.setItem(GUEST_KEY, '1')
    resetProjectState()
    set({ guest: true, loading: false })
  },
}))
