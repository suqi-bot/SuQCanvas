import { db } from '../db/db'
import { downloadAssetFromOss, getOssThumb, isOssConfigured } from '../sync/ossClient'
import { fetchCloudAssets } from '../sync/cloudSync'
import { requestAssetFromLan } from '../sync/lanClient'

const urlCache = new Map<string, string>()
const thumbCache = new Map<string, string>()

export function invalidateAssetUrl(assetId: string): void {
  const url = urlCache.get(assetId)
  if (url) URL.revokeObjectURL(url)
  urlCache.delete(assetId)
}

export function invalidateThumbnailUrl(assetId: string): void {
  const url = thumbCache.get(assetId)
  if (url) URL.revokeObjectURL(url)
  thumbCache.delete(assetId)
}

export function invalidateAllAssetUrls(assetId: string): void {
  invalidateAssetUrl(assetId)
  invalidateThumbnailUrl(assetId)
}

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
  const blob = await getAssetBlob(assetId)
  const url = URL.createObjectURL(blob)
  urlCache.set(assetId, url)
  return url
}

/** 获取原始资源 Blob（优先本地缓存，其次云端/局域网拉取） */
export async function getAssetBlob(assetId: string): Promise<Blob> {
  let record = await db.assets.get(assetId)
  if (!record || !(record.blob instanceof Blob)) {
    if (record) await db.assets.delete(assetId)
    await fetchBlobFromCloud(assetId)
    record = await db.assets.get(assetId)
  }
  if (!record || !(record.blob instanceof Blob)) {
    // 局域网资源可能还在传输中，多尝试几次
    for (let attempt = 0; attempt < 3 && !record; attempt++) {
      const ok = await requestAssetFromLan(assetId)
      if (ok) record = await db.assets.get(assetId)
    }
    if (!record) record = await db.assets.get(assetId)
  }
  if (!record || !(record.blob instanceof Blob)) throw new Error(`资源不存在: ${assetId}`)
  return record.blob
}

export async function getThumbnailUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbCache.get(assetId)
  if (cached) return cached
  let record = await db.assets.get(assetId)
  if (!record || !(record.blob instanceof Blob)) {
    if (record) await db.assets.delete(assetId)
    await fetchBlobFromCloud(assetId)
    record = await db.assets.get(assetId)
    if (!record || !(record.blob instanceof Blob)) return undefined
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
