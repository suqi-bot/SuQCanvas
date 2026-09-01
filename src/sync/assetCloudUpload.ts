import type { AssetMeta } from '../types'
import { isCloudAuthed, upsertAssetMetaToCloud } from './cloudSync'
import { isOssConfigured, uploadAssetToOssWithProgress, uploadThumbToOss } from './ossClient'

/** 当前环境是否需要执行云端素材上传（在线版 + 已配置 OSS + 已登录） */
export async function cloudUploadApplies(): Promise<boolean> {
  return isOssConfigured() && (await isCloudAuthed())
}

/**
 * 上传素材到云端：OSS 主文件（带进度）+ 可选封面 + Supabase 元数据。
 * 遵循仓库约定不向上抛 I/O 异常，统一以布尔结果表示成败；
 * 进度回调收到 1 表示整条链路全部完成。
 */
export async function runAssetCloudUpload(
  meta: AssetMeta,
  blob: Blob,
  thumbnail: Blob | undefined,
  onProgress?: (ratio: number) => void,
): Promise<boolean> {
  onProgress?.(0)
  let ossKey = ''
  try {
    // 主文件占进度 0~0.9，封面与元数据占剩余部分
    ossKey = await uploadAssetToOssWithProgress(meta.id, blob, (ratio) => onProgress?.(ratio * 0.9))
  } catch (err) {
    console.warn('素材上传到 OSS 失败:', meta.name, err)
    return false
  }
  if (!ossKey) return false
  let ossThumbKey: string | undefined
  if (thumbnail) {
    try {
      ossThumbKey = await uploadThumbToOss(meta.id, thumbnail)
    } catch {
      // 缩略图上传失败不影响主文件
    }
  }
  onProgress?.(0.95)
  const metaSynced = await upsertAssetMetaToCloud(meta, ossKey, ossThumbKey)
  if (!metaSynced) return false
  onProgress?.(1)
  return true
}
