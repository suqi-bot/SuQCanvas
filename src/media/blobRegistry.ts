import { db } from '../db/db'
import { downloadAssetFromOss, getOssThumb, isOssConfigured } from '../sync/ossClient'
import { fetchCloudAssets } from '../sync/cloudSync'
import { requestAssetFromLan } from '../sync/lanClient'

const urlCache = new Map<string, string>()
const thumbCache = new Map<string, string>()

async function fetchBlobFromCloud(assetId: string): Promise<void> {
  if (!isOssConfigured()) return
  const blob = await downloadAssetFromOss(assetId)
  if (!blob) return
  const meta = (await fetchCloudAssets([assetId]))[0]
  let thumb: Blob | undefined
  if (meta?.oss_thumb_key) {
    try {
      thumb = (await getOssThumb(assetId)).content
    } catch {
      // 缩略图缺失不影响主文件
    }
  }
  await db.assets.put({
    id: assetId,
    name: meta?.name ?? '资源',
    mime: meta?.mime ?? 'application/octet-stream',
    size: blob.size,
    kind: meta?.kind ?? 'file',
    blob,
    thumbnail: thumb,
  })
}

export async function getAssetUrl(assetId: string): Promise<string> {
  const cached = urlCache.get(assetId)
  if (cached) return cached
  let record = await db.assets.get(assetId)
  if (!record) {
    await fetchBlobFromCloud(assetId)
    record = await db.assets.get(assetId)
  }
  if (!record) {
    const ok = await requestAssetFromLan(assetId)
    if (ok) record = await db.assets.get(assetId)
  }
  if (!record) throw new Error(`资源不存在: ${assetId}`)
  const url = URL.createObjectURL(record.blob)
  urlCache.set(assetId, url)
  return url
}

export async function getThumbnailUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbCache.get(assetId)
  if (cached) return cached
  let record = await db.assets.get(assetId)
  if (!record) {
    await fetchBlobFromCloud(assetId)
    record = await db.assets.get(assetId)
    if (!record) return undefined
  }
  if (!record.thumbnail) return undefined
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
