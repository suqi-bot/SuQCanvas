import OSS from 'ali-oss'
import { db } from '../db/db'
import { assetKey, isOssConfigured, thumbKey } from './ossConfig'

const region = import.meta.env.VITE_OSS_REGION as string | undefined
const bucket = import.meta.env.VITE_OSS_BUCKET as string | undefined
const accessKeyId = import.meta.env.VITE_OSS_ACCESS_KEY_ID as string | undefined
const accessKeySecret = import.meta.env.VITE_OSS_ACCESS_KEY_SECRET as string | undefined
const stsUrl = import.meta.env.VITE_OSS_STS_URL as string | undefined

let client: OSS | null = null
let clientExpiresAt = 0

interface OssCredentials {
  accessKeyId: string
  accessKeySecret: string
  stsToken?: string
  expiresAt?: number
}

async function getCredentials(): Promise<OssCredentials> {
  if (stsUrl) {
    const headers: Record<string, string> = {}
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (anon) {
      headers['Authorization'] = `Bearer ${anon}`
      headers['apikey'] = anon
    }
    const res = await fetch(stsUrl, { headers })
    if (!res.ok) throw new Error('获取 OSS STS 凭证失败')
    const data = await res.json()
    return {
      accessKeyId: data.accessKeyId,
      accessKeySecret: data.accessKeySecret,
      stsToken: data.securityToken,
      expiresAt: data.expiration
        ? new Date(data.expiration).getTime()
        : Date.now() + 3600 * 1000,
    }
  }
  return {
    accessKeyId: accessKeyId as string,
    accessKeySecret: accessKeySecret as string,
    expiresAt: Number.POSITIVE_INFINITY,
  }
}

export async function getOssClient(): Promise<OSS | null> {
  if (!isOssConfigured()) return null
  if (client && Date.now() < clientExpiresAt - 5 * 60 * 1000) return client
  const creds = await getCredentials()
  client = new OSS({
    region,
    bucket,
    accessKeyId: creds.accessKeyId,
    accessKeySecret: creds.accessKeySecret,
    stsToken: creds.stsToken,
    secure: true,
    refreshSTSToken: creds.stsToken
      ? async () => {
          const fresh = await getCredentials()
          return {
            accessKeyId: fresh.accessKeyId,
            accessKeySecret: fresh.accessKeySecret,
            stsToken: fresh.stsToken ?? '',
          }
        }
      : undefined,
    refreshSTSTokenInterval: 300000,
  })
  clientExpiresAt = creds.expiresAt ?? Date.now() + 3600 * 1000
  return client
}

// 大于该阈值走分片上传，以获得进度回调；小文件直接 put
const MULTIPART_THRESHOLD = 10 * 1024 * 1024
const MULTIPART_PART_SIZE = 2 * 1024 * 1024
const MULTIPART_PARALLEL = 4
// 断点落盘节流间隔，避免每个分片回调都写 IndexedDB
const CHECKPOINT_SAVE_INTERVAL_MS = 1000

/** 读取已持久化的断点；key/文件大小/分片大小不匹配时视为失效并清除 */
async function loadOssCheckpoint(
  assetId: string,
  key: string,
  fileSize: number,
): Promise<OSS.Checkpoint | null> {
  try {
    const record = await db.uploadCheckpoints.get(assetId)
    if (!record) return null
    const cp = record.checkpoint
    const valid =
      record.key === key &&
      record.fileSize === fileSize &&
      cp.name === key &&
      cp.fileSize === fileSize &&
      cp.partSize === MULTIPART_PART_SIZE &&
      Boolean(cp.uploadId) &&
      Array.isArray(cp.doneParts)
    if (!valid) {
      await db.uploadCheckpoints.delete(assetId)
      return null
    }
    return { ...cp, file: null }
  } catch (err) {
    console.warn('读取上传断点失败:', assetId, err)
    return null
  }
}

/** 落盘断点；剔除不可序列化的 file 引用，失败仅降级不影响上传本身 */
async function saveOssCheckpoint(
  assetId: string,
  key: string,
  blob: Blob,
  cp: OSS.Checkpoint,
): Promise<void> {
  try {
    await db.uploadCheckpoints.put({
      assetId,
      key,
      fileSize: blob.size,
      updatedAt: Date.now(),
      checkpoint: {
        name: cp.name,
        fileSize: cp.fileSize,
        partSize: cp.partSize,
        uploadId: cp.uploadId,
        doneParts: cp.doneParts.map((p) => ({ number: p.number, etag: p.etag })),
      },
    })
  } catch (err) {
    console.warn('持久化上传断点失败:', assetId, err)
  }
}

async function deleteOssCheckpoint(assetId: string): Promise<void> {
  try {
    await db.uploadCheckpoints.delete(assetId)
  } catch {
    // 删除失败仅遗留无效断点，下次上传时校验会自然淘汰
  }
}

/** 上传媒体文件到 OSS（带进度、断点续传），返回 oss_key */
export async function uploadAssetToOssWithProgress(
  assetId: string,
  blob: Blob,
  onProgress: (ratio: number) => void,
): Promise<string> {
  const c = await getOssClient()
  if (!c) return ''
  const key = assetKey(assetId)
  if (blob.size < MULTIPART_THRESHOLD) {
    await c.put(key, blob, { mime: blob.type || undefined })
    onProgress(1)
    return key
  }
  // 恢复上次失败/页面关闭前持久化的断点，续传时只补传未完成分片；
  // 从 IndexedDB 取出的 Blob 不是 File 实例，ali-oss 不会自动回填，需手动挂载
  const saved = await loadOssCheckpoint(assetId, key, blob.size)
  const resumeCheckpoint = saved ? { ...saved, file: blob } : undefined
  let latestCheckpoint = resumeCheckpoint
  let lastSavedAt = 0
  try {
    await c.multipartUpload(key, blob, {
      mime: blob.type || undefined,
      partSize: MULTIPART_PART_SIZE,
      parallel: MULTIPART_PARALLEL,
      checkpoint: resumeCheckpoint,
      progress: (percentage: number, cp?: OSS.Checkpoint) => {
        onProgress(Math.max(0, Math.min(1, percentage)))
        if (cp?.uploadId) {
          latestCheckpoint = cp
          const now = Date.now()
          if (now - lastSavedAt >= CHECKPOINT_SAVE_INTERVAL_MS) {
            lastSavedAt = now
            void saveOssCheckpoint(assetId, key, blob, cp)
          }
        }
      },
    })
  } catch (err) {
    // abort 表示 uploadId 已在服务端失效，断点无法再复用；其余错误保留断点供下次续传，
    // 失败前补一次同步落盘，确保进度回调节流期内完成的部分不丢
    if ((err as { name?: string } | null)?.name === 'abort') {
      await deleteOssCheckpoint(assetId)
    } else if (latestCheckpoint?.uploadId) {
      await saveOssCheckpoint(assetId, key, blob, latestCheckpoint)
    }
    throw err
  }
  await deleteOssCheckpoint(assetId)
  onProgress(1)
  return key
}

/** 上传视频缩略图到 OSS */
export async function uploadThumbToOss(assetId: string, blob: Blob): Promise<string> {
  const c = await getOssClient()
  if (!c) return ''
  const key = thumbKey(assetId)
  await c.put(key, blob)
  return key
}

/** ali-oss 浏览器版 get() 返回 Buffer（Uint8Array），统一转成 Blob */
function toBlob(content: unknown): Blob | null {
  if (content instanceof Blob) return content
  if (content instanceof ArrayBuffer) return new Blob([content])
  if (content instanceof Uint8Array) return new Blob([new Uint8Array(content)])
  if (typeof content === 'string') return new Blob([content])
  return null
}

/** 从 OSS 下载媒体文件 */
export async function downloadAssetFromOss(assetId: string): Promise<Blob | null> {
  const c = await getOssClient()
  if (!c) return null
  try {
    const { content } = await c.get(assetKey(assetId))
    return toBlob(content)
  } catch (err) {
    console.warn('从 OSS 下载失败:', assetId, err)
    return null
  }
}

/** 从 OSS 下载视频缩略图 */
export async function getOssThumb(assetId: string): Promise<{ content: Blob }> {
  const c = await getOssClient()
  if (!c) throw new Error('OSS 未配置')
  const { content } = await c.get(thumbKey(assetId))
  const blob = toBlob(content)
  if (!blob) throw new Error('OSS 缩略图格式异常')
  return { content: blob }
}

/** 获取 OSS 媒体文件可访问 URL（私有桶为签名 URL，默认 1 小时有效） */
export async function getOssUrl(assetId: string): Promise<string | null> {
  const c = await getOssClient()
  if (!c) return null
  try {
    return c.signatureUrl(assetKey(assetId), { expires: 3600 })
  } catch (err) {
    console.warn('生成 OSS URL 失败:', assetId, err)
    return null
  }
}
