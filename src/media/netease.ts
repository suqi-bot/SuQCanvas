// 网易云链接/ID 解析（与 desktop/netease.cjs 保持同一套规则）
export type NeteaseRefType = 'song' | 'playlist' | 'album' | 'home'

export interface NeteaseRef {
  type: NeteaseRefType
  id?: string
}

export const NETEASE_HOME = 'https://music.163.com/'

const ALLOWED_HOSTS = new Set(['music.163.com', 'y.music.163.com', 'music.126.net'])

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.has(host) || host.endsWith('.music.163.com') || host.endsWith('.music.126.net')
}

export function parseNeteaseTarget(input: string | null | undefined): NeteaseRef | null {
  const raw = (input ?? '').trim()
  if (!raw) return { type: 'home' }
  if (/^\d+$/.test(raw)) return { type: 'song', id: raw }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!hostAllowed(url.hostname)) return null
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const combined = `${url.pathname}${url.search}${hash}`
  const id = url.searchParams.get('id') || (hash.match(/[?&]id=(\d+)/)?.[1] ?? '')
  if (/\/playlist/i.test(combined)) return id ? { type: 'playlist', id } : { type: 'home' }
  if (/\/album/i.test(combined)) return id ? { type: 'album', id } : { type: 'home' }
  if (/\/song/i.test(combined)) return id ? { type: 'song', id } : { type: 'home' }
  return { type: 'home' }
}

export function neteaseUrlFor(ref: NeteaseRef | null | undefined): string {
  if (!ref || ref.type === 'home' || !ref.id) return NETEASE_HOME
  if (ref.type === 'playlist') return `https://music.163.com/#/playlist?id=${encodeURIComponent(ref.id)}`
  if (ref.type === 'album') return `https://music.163.com/#/album?id=${encodeURIComponent(ref.id)}`
  return `https://music.163.com/#/song?id=${encodeURIComponent(ref.id)}`
}

export function isNeteaseInput(input: string | null | undefined): boolean {
  return parseNeteaseTarget(input) !== null
}

/** 侧栏拖到画布的 dataTransfer 类型 */
export const NETEASE_DRAG_MIME = 'application/x-suqcanvas-netease'

export interface NeteaseDragPayload {
  id: string
  name: string
  artist?: string
  coverUrl?: string
}

export function parseNeteaseDragPayload(raw: string | null | undefined): NeteaseDragPayload | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<NeteaseDragPayload>
    const id = typeof data.id === 'string' ? data.id.trim() : ''
    if (!id || !/^\d+$/.test(id)) return null
    return {
      id,
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : `网易云歌曲 ${id}`,
      artist: typeof data.artist === 'string' ? data.artist : undefined,
      coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
    }
  } catch {
    return null
  }
}
