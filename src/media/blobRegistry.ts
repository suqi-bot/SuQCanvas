import { db } from '../db/db'

const urlCache = new Map<string, string>()
const thumbCache = new Map<string, string>()

export async function getAssetUrl(assetId: string): Promise<string> {
  const cached = urlCache.get(assetId)
  if (cached) return cached
  const record = await db.assets.get(assetId)
  if (!record) throw new Error(`资源不存在: ${assetId}`)
  const url = URL.createObjectURL(record.blob)
  urlCache.set(assetId, url)
  return url
}

export async function getThumbnailUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbCache.get(assetId)
  if (cached) return cached
  const record = await db.assets.get(assetId)
  if (!record || !record.thumbnail) return undefined
  const url = URL.createObjectURL(record.thumbnail)
  thumbCache.set(assetId, url)
  return url
}

export function revokeAllUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  for (const url of thumbCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
  thumbCache.clear()
}
