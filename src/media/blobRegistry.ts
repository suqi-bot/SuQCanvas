import { db, type AssetRecord } from '../db/db'
import { downloadAssetFromOss, getOssThumb, isOssConfigured } from '../sync/ossClient'
import { fetchCloudAssets } from '../sync/cloudSync'
import {
  getLanAssetHttpUrl,
  getLanAssetThumbnail,
  pushThumbnailToServer,
  requestAssetFromLan,
} from '../sync/lanClient'
import type { MediaKind } from '../types'

const urlCache = new Map<string, string>()
const thumbCache = new Map<string, string>()
/** 正在生成封面缩略图的资产，防止多个节点并发重复抓帧 */
const thumbnailGenerating = new Set<string>()
/** HTTP 抓帧失败后已做过 blob 兜底的资产（一次性，避免反复拉取大文件） */
const blobFallbackAttempted = new Set<string>()
/** 已向局域网发起过取源请求、尚未收到回包的资产（防止轮询重复堆积等待者） */
const lanSourceRequested = new Set<string>()
/** 封面抓帧并发上限：避免多个隐藏 video 同时 seek 同一台服务器，占满浏览器连接池阻塞视频播放 */
const THUMB_MAX_CONCURRENT = 2
let thumbActive = 0
const thumbQueue: Array<() => void> = []

/** 获取抓帧并发槽位（槽位满则排队等待），返回释放函数 */
function acquireThumbSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const run = () => {
      thumbActive += 1
      resolve(() => {
        thumbActive -= 1
        const next = thumbQueue.shift()
        if (next) next()
      })
    }
    if (thumbActive < THUMB_MAX_CONCURRENT) run()
    else thumbQueue.push(run)
  })
}

export function invalidateAssetUrl(assetId: string): void {
  const url = urlCache.get(assetId)
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
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
  const meta = (await fetchCloudAssets([assetId]))[0]
  const blob = await downloadAssetFromOss(assetId)
  if (!blob) return
  const mime = meta?.mime ?? 'application/octet-stream'
  const typedBlob = blob.type ? blob : new Blob([blob], { type: mime })
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
    mime,
    size: typedBlob.size,
    kind: meta?.kind ?? 'file',
    blob: typedBlob,
    thumbnail: thumb,
  })
}

export async function getAssetUrl(assetId: string): Promise<string> {
  const cached = urlCache.get(assetId)
  if (cached) return cached
  // 本地已有完整资源优先用本地（离线可用、行为与以往一致）
  const local = await db.assets.get(assetId)
  if (local?.blob instanceof Blob && local.blob.size > 0) {
    const url = URL.createObjectURL(local.blob)
    urlCache.set(assetId, url)
    return url
  }
  // 视频：服务器可提供 HTTP Range 流式拉流时直接用（边下边播、可拖动进度），
  // 避免把大视频整份下载到本地 IndexedDB 造成内存/磁盘压力
  const httpUrl = getLanAssetHttpUrl(assetId)
  if (httpUrl) {
    urlCache.set(assetId, httpUrl)
    return httpUrl
  }
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
    // 局域网资源可能还在传输中。requestAssetFromLan 采用空闲超时（持续有分片即续期），
    // 重试主要兜底“源端不在线”场景：失败后重发一次请求等待源端上线。
    for (let attempt = 0; attempt < 2 && !record; attempt++) {
      const ok = await requestAssetFromLan(assetId)
      if (ok) record = await db.assets.get(assetId)
    }
    if (!record) record = await db.assets.get(assetId)
  }
  if (!record || !(record.blob instanceof Blob)) throw new Error(`资源不存在: ${assetId}`)
  return record.blob
}

/** 用视频源地址（本地 blob URL 或局域网 HTTP 流式地址）抓取视频画面生成封面 jpeg */
function captureVideoThumbnailFromUrl(sourceUrl: string): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    // 局域网 HTTP 流式地址与网页可能不同源（Vite 开发站/反代域名 vs 中继 8790）：
    // 需显式跨源请求（配合服务器 Access-Control-Allow-Origin）才能画到 canvas 上，
    // 否则 canvas 被污染，getImageData/toBlob 抛 SecurityError，封面永远生成失败。
    video.crossOrigin = 'anonymous'
    video.src = sourceUrl
    let settled = false
    let captureAttempts = 0
    const MAX_ATTEMPTS = 4

    const finish = (blob?: Blob) => {
      if (settled) return
      settled = true
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        // 忽略清理失败
      }
      resolve(blob)
    }

    video.onerror = () => finish()

    /** 抓帧；画面为黑帧（未解码完成或恰为黑场）时自动 seek 到下一个采样点重试 */
    const tryCapture = () => {
      if (settled) return
      try {
        const w = video.videoWidth || 320
        const h = video.videoHeight || 180
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finish()
          return
        }
        ctx.drawImage(video, 0, 0, w, h)
        // 黑帧检测：平均亮度极低视为画面未解码完成或恰为黑场
        let avg = 255
        try {
          const data = ctx.getImageData(0, 0, w, h).data
          const stride = Math.max(1, Math.floor(data.length / 4000 / 4) * 4)
          let sum = 0
          let count = 0
          for (let i = 0; i < data.length; i += stride) {
            sum += data[i] + data[i + 1] + data[i + 2]
            count += 3
          }
          avg = count > 0 ? sum / count : 255
        } catch {
          // 读取像素失败则按非黑帧处理，直接出图
        }
        const duration = video.duration || 0
        if (avg < 8 && captureAttempts < MAX_ATTEMPTS && duration > 1) {
          captureAttempts += 1
          const target = Math.min(duration - 0.1, Math.max(0.1, (video.currentTime || 0) + duration * 0.25))
          if (Math.abs(target - (video.currentTime || 0)) < 0.05) {
            finish()
            return
          }
          try {
            video.currentTime = target
            return // 等下一次 onseeked
          } catch {
            finish()
            return
          }
        }
        canvas.toBlob((blob) => finish(blob ?? undefined), 'image/jpeg', 0.75)
      } catch {
        finish()
      }
    }

    // 用 loadedmetadata（而非 loadeddata）：局域网流式视频 preload=metadata 时 loadeddata 可能不触发
    video.onloadedmetadata = () => {
      try {
        const duration = video.duration || 0
        video.currentTime = duration > 2 ? duration / 2 : 0.1
      } catch {
        finish()
      }
    }

    video.onseeked = () => {
      // 等待画面实际渲染后再抓，避免拿到未解码的黑帧
      const rvfc = (video as unknown as {
        requestVideoFrameCallback?: (cb: () => void) => number
      }).requestVideoFrameCallback
      if (rvfc) {
        try {
          rvfc.call(video, () => tryCapture())
          return
        } catch {
          // 回退到下面的延迟方案
        }
      }
      setTimeout(tryCapture, 120)
    }

    // 兜底超时，避免视频无法加载时 Promise 挂起
    setTimeout(() => finish(), 15000)
  })
}

/** 视频资产本地无封面时，用本地 blob（peer 传输）或局域网 HTTP 流式地址抓帧生成并落库 */
async function ensureVideoThumbnail(
  record: AssetRecord | undefined,
  assetId: string,
): Promise<Blob | undefined> {
  const isVideo =
    record?.kind === 'video' || (record?.mime ?? '').startsWith('video/') || !!getLanAssetHttpUrl(assetId)
  if (!isVideo) return undefined
  if (thumbnailGenerating.has(assetId)) return undefined
  thumbnailGenerating.add(assetId)
  // 限制同时抓帧数量：并发 seek 会占满浏览器对同一主机的连接，阻塞视频播放
  const release = await acquireThumbSlot()
  try {
    const hasLocal = !!record?.blob && record.blob.size > 0
    const sourceUrl = hasLocal ? URL.createObjectURL(record.blob) : getLanAssetHttpUrl(assetId)
    if (!sourceUrl) return undefined
    const thumb = await captureVideoThumbnailFromUrl(sourceUrl)
    if (hasLocal && sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl)
    if (thumb) {
      const base = record ?? { id: assetId, name: assetId, mime: 'video/mp4', size: 0, kind: 'video' as MediaKind }
      await db.assets.put({ ...base, thumbnail: thumb } as AssetRecord)
    }
    return thumb
  } finally {
    release()
    thumbnailGenerating.delete(assetId)
  }
}

/** 判断图片 blob 是否为接近全黑（旧版本抓帧可能产出黑图，用于自检替换） */
function isImageMostlyBlack(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 32
        canvas.height = img.naturalHeight || 32
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          resolve(false)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const stride = Math.max(1, Math.floor(data.length / 4000 / 4) * 4)
        let sum = 0
        let count = 0
        for (let i = 0; i < data.length; i += stride) {
          sum += data[i] + data[i + 1] + data[i + 2]
          count += 3
        }
        URL.revokeObjectURL(url)
        resolve(count > 0 ? sum / count < 8 : false)
      } catch {
        URL.revokeObjectURL(url)
        resolve(false)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(false)
    }
    img.src = url
  })
}

export async function getThumbnailUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbCache.get(assetId)
  if (cached) return cached
  // 局域网同步来的封面优先：上传端已抓好帧，观看端不必再解码一次
  const synced = getLanAssetThumbnail(assetId)
  if (synced) {
    const url = URL.createObjectURL(synced)
    thumbCache.set(assetId, url)
    return url
  }
  let record = await db.assets.get(assetId)
  const hasBlob = () => !!record?.blob && record.blob.size > 0
  // 记录存在但无 blob 说明是局域网 meta-only 记录（文件走 HTTP 流式拉取），不必再从 OSS 整份下载
  if (!record) {
    await fetchBlobFromCloud(assetId)
    record = await db.assets.get(assetId)
  }
  const isVideo =
    record?.kind === 'video' || (record?.mime ?? '').startsWith('video/') || !!getLanAssetHttpUrl(assetId)
  // 已有封面（含局域网 meta-only 记录此前生成过封面）
  if (record?.thumbnail) {
    let thumb = record.thumbnail
    // 视频封面黑帧自检：旧版本抓帧可能产出黑图，检测到则重新抓帧替换
    if (isVideo && (await isImageMostlyBlack(thumb))) {
      const regenerated = await ensureVideoThumbnail(record, assetId)
      if (regenerated) thumb = regenerated
    }
    // 本地有封面就补推一份给中继：封面同步能力上线前缓存的视频在服务器上没有 .thumb
    if (isVideo) pushThumbnailToServer(assetId, thumb)
    const url = URL.createObjectURL(thumb)
    thumbCache.set(assetId, url)
    return url
  }
  // 视频但本地既无文件也无流式地址（刷新后 httpAssetUrls 已清空）：
  // 主动请求一次，中继会回 asset-http（流式地址）+ asset-thumb（封面），否则这里永远取不到源
  if (isVideo && !hasBlob() && !getLanAssetHttpUrl(assetId)) {
    if (!lanSourceRequested.has(assetId)) {
      lanSourceRequested.add(assetId)
      void requestAssetFromLan(assetId).then(() => lanSourceRequested.delete(assetId))
    }
    return undefined
  }
  // 视频：本地有 blob（peer 传输）或走 HTTP 流式（服务器缓存）时，抓帧生成封面
  if (isVideo && (hasBlob() || getLanAssetHttpUrl(assetId))) {
    const thumb = await ensureVideoThumbnail(record, assetId)
    if (thumb) {
      pushThumbnailToServer(assetId, thumb)
      const url = URL.createObjectURL(thumb)
      thumbCache.set(assetId, url)
      return url
    }
    // HTTP 抓帧兜底：跨源/代理/编码异常等情况可能失败，一次性拉取全量素材，
    // 用同源 blob URL 再抓一次保证封面最终可生成（仅在无本地文件时触发，避免反复拉大文件）
    if (!hasBlob() && !blobFallbackAttempted.has(assetId)) {
      blobFallbackAttempted.add(assetId)
      const ok = await requestAssetFromLan(assetId, { forceBlob: true })
      const fresh = ok ? await db.assets.get(assetId) : null
      if (fresh?.blob instanceof Blob && fresh.blob.size > 0) {
        const thumb2 = await ensureVideoThumbnail(fresh, assetId)
        if (thumb2) {
          pushThumbnailToServer(assetId, thumb2)
          const url = URL.createObjectURL(thumb2)
          thumbCache.set(assetId, url)
          return url
        }
      }
    }
  }
  return undefined
}

export function revokeAllUrls(): void {
  for (const url of urlCache.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  for (const url of thumbCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
  thumbCache.clear()
}
