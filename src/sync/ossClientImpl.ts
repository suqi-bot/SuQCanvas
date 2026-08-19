import OSS from 'ali-oss'
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

/** 上传媒体文件到 OSS，返回 oss_key */
export async function uploadAssetToOss(assetId: string, blob: Blob): Promise<string> {
  const c = await getOssClient()
  if (!c) return ''
  const key = assetKey(assetId)
  await c.put(key, blob)
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
