import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_ONLINE_BUILD } from '../buildMode'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// 局域网版构建时 IS_ONLINE_BUILD 为 false 字面量，createClient 分支被摇树移除，
// @supabase/supabase-js 不会进入产物
export const supabase: SupabaseClient | null = IS_ONLINE_BUILD
  ? url && anonKey
    ? createClient(url, anonKey)
    : null
  : null

export function isCloudConfigured(): boolean {
  return supabase !== null
}
