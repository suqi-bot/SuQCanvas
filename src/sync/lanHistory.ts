export interface RecentLanServer { url: string; name: string; usedAt: number }
const STORAGE = 'sq:lan-recent-servers'
export function recentLanServers(): RecentLanServer[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) || '[]')
    return Array.isArray(value) ? value.filter((item) => typeof item?.url === 'string' && typeof item?.name === 'string' && typeof item?.usedAt === 'number').slice(0, 8) : []
  } catch { return [] }
}
export function rememberLanServer(url: string, name: string) {
  try { localStorage.setItem(STORAGE, JSON.stringify([{ url, name, usedAt: Date.now() }, ...recentLanServers().filter((item) => item.url !== url)].slice(0, 8))) }
  catch { /* Connection remains usable if device storage is full. */ }
}
