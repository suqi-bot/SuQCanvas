import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const desktopCloudConfig = {
  url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  region: import.meta.env.VITE_OSS_REGION as string | undefined,
  bucket: import.meta.env.VITE_OSS_BUCKET as string | undefined,
  stsUrl: import.meta.env.VITE_OSS_STS_URL as string | undefined,
}

export function isDesktopCloudConfigured(): boolean {
  return Boolean(desktopCloudConfig.url && desktopCloudConfig.key)
}

let client: SupabaseClient | undefined

/** Independent session: never set useAuthStore.user or redirect local saves into the cloud. */
export function getDesktopCloudClient(): SupabaseClient {
  if (!isDesktopCloudConfigured()) throw new Error('此安装包尚未配置在线版服务')
  client ??= createClient(desktopCloudConfig.url!, desktopCloudConfig.key!, {
    auth: { storageKey: 'sq:desktop-cloud-auth', detectSessionInUrl: false },
  })
  return client
}
