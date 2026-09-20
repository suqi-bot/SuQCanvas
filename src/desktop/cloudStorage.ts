import { desktopCloudConfig, getDesktopCloudClient } from './cloudClient'
import type OSS from 'ali-oss'

let cached: { client: OSS; owner: string; expiresAt: number } | undefined

function validateKey(key: string) {
  if (!key || key.startsWith('/') || key.includes('..') || /^[a-z]+:/i.test(key)) {
    throw new Error('云端素材路径无效')
  }
}

/** Account-scoped OSS client using only short-lived credentials. */
async function getStorage(expectedOwner?: string) {
  const { region, bucket, stsUrl, key: apiKey } = desktopCloudConfig
  if (!region || !bucket || !stsUrl) throw new Error('尚未配置云端素材下载服务，请使用包含在线版 OSS STS 配置的安装包')
  const { data, error } = await getDesktopCloudClient().auth.getSession()
  if (error || !data.session) throw new Error('请先登录在线账号')
  const owner = data.session.user.id
  if (expectedOwner && owner !== expectedOwner) throw new Error('账号已切换，请重新保存')
  if (!cached || cached.owner !== owner || cached.expiresAt <= Date.now() + 60000) {
    const response = await fetch(stsUrl, { headers: {
      Authorization: `Bearer ${data.session.access_token}`, apikey: apiKey!,
    }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`云端素材授权失败（${response.status}）`)
    const credentials = await response.json()
    if (!credentials.accessKeyId || !credentials.accessKeySecret || !credentials.securityToken) {
      throw new Error('云端素材服务未返回有效的临时凭证')
    }
    const { default: OSS } = await import('ali-oss')
    const oss = new OSS({ region, bucket, secure: true, accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret, stsToken: credentials.securityToken })
    const expiresAt = Date.parse(credentials.expiration)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000) throw new Error('云端素材凭证已过期，请重试')
    cached = { client: oss, owner, expiresAt }
  }
  return cached
}

export async function writeCloudObject(key: string, blob: Blob, owner: string): Promise<void> {
  validateKey(key)
  const { client } = await getStorage(owner)
  if (blob.size >= 10 * 1024 * 1024) {
    await client.multipartUpload(key, blob, { mime: blob.type || undefined, partSize: 2 * 1024 * 1024, parallel: 4 })
  } else {
    await client.put(key, blob, { mime: blob.type || undefined })
  }
}

export async function readCloudObject(key: string, mime: string): Promise<Blob> {
  validateKey(key)
  const cached = await getStorage()
  // Fetch the exact object key from the authenticated metadata query, including historical keys.
  const url = cached.client.signatureUrl(key, { expires: Math.min(3600, Math.floor((cached.expiresAt - Date.now()) / 1000)) })
  const result = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
  if (!result.ok) throw new Error(`素材下载失败（${result.status}）`)
  const blob = await result.blob()
  return blob.type === mime ? blob : new Blob([blob], { type: mime })
}
