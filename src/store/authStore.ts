import { create } from 'zustand'
import type { AuthError, User } from '@supabase/supabase-js'
import { supabase } from '../sync/supabaseClient'
import { db } from '../db/db'
import { useProjectStore } from './projectStore'
import { useCanvasStore } from './canvasStore'

interface AuthState {
  user: User | null
  loading: boolean
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  init: async () => {
    if (!supabase) {
      set({ loading: false })
      return
    }
    if (!listenerInstalled) {
      listenerInstalled = true
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ user: session?.user ?? null, loading: false })
      })
    }
    const { data } = await supabase.auth.getSession()
    set({ user: data.session?.user ?? null, loading: false })
  },

  signIn: async (email, password) => {
    if (!supabase) return '未配置 Supabase，无法登录'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? translateAuthError(error) : null
  },

  signOut: async () => {
    if (supabase) await supabase.auth.signOut()
    await db.projects.clear()
    await db.assets.clear()
    useProjectStore.setState({
      projectId: null,
      projectName: '未命名项目',
      loaded: false,
      initialized: false,
      saveStatus: 'idle',
    })
    useCanvasStore.getState().reset()
    useCanvasStore.getState().clearHistory()
    set({ user: null })
  },
}))
