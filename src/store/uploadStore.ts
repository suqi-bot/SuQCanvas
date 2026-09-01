import { create } from 'zustand'
import { db, type CloudUploadState } from '../db/db'
import { cloudUploadApplies, runAssetCloudUpload } from '../sync/assetCloudUpload'
import type { AssetMeta } from '../types'
import { toast } from './uiStore'

export interface UploadStatus {
  state: CloudUploadState
  /** 0~1 的上传进度，仅 uploading 状态有意义 */
  progress: number
}

interface UploadStoreState {
  /** assetId → 实时上传状态；成功状态短暂保留后自动移除 */
  uploads: Record<string, UploadStatus>
  /** 上传（或重新上传）素材到云端，返回是否成功 */
  runCloudUpload: (assetId: string) => Promise<boolean>
}

// 进度回调节流间隔，避免分片回调高频触发重渲染
const PROGRESS_THROTTLE_MS = 120
// 成功后"已上传"徽标保留时长
const DONE_BADGE_MS = 4000

export const useUploadStore = create<UploadStoreState>((set, get) => ({
  uploads: {},
  runCloudUpload: async (assetId) => {
    if (get().uploads[assetId]?.state === 'uploading') return false
    const record = await db.assets.get(assetId)
    if (!record) return false
    if (!(await cloudUploadApplies())) return false
    if (!record.blob || record.blob.size === 0) {
      toast(`「${record.name}」本地数据缺失，无法上传`, 'error')
      return false
    }
    const meta: AssetMeta = {
      id: record.id,
      name: record.name,
      mime: record.mime,
      size: record.size,
      kind: record.kind,
      hasThumbnail: Boolean(record.thumbnail),
    }
    const setStatus = (state: CloudUploadState, progress: number) => {
      set((current) => ({ uploads: { ...current.uploads, [assetId]: { state, progress } } }))
    }
    setStatus('uploading', 0)
    await db.assets.update(assetId, { cloudStatus: 'uploading' })
    let lastEmit = 0
    const ok = await runAssetCloudUpload(meta, record.blob, record.thumbnail, (ratio) => {
      const now = Date.now()
      if (ratio >= 1 || now - lastEmit >= PROGRESS_THROTTLE_MS) {
        lastEmit = now
        setStatus('uploading', ratio)
      }
    })
    if (ok) {
      setStatus('done', 1)
      await db.assets.update(assetId, { cloudStatus: 'done' })
      setTimeout(() => {
        set((current) => {
          if (current.uploads[assetId]?.state !== 'done') return current
          const uploads = { ...current.uploads }
          delete uploads[assetId]
          return { uploads }
        })
      }, DONE_BADGE_MS)
      return true
    }
    setStatus('failed', 0)
    await db.assets.update(assetId, { cloudStatus: 'failed' })
    toast(`「${record.name}」上传云端失败`, 'error')
    return false
  },
}))

/** 上传中途关闭页面会残留 uploading 状态，启动后统一改为 failed 使其可在文件列表重试 */
export async function repairStuckUploads(): Promise<void> {
  if (!(await cloudUploadApplies())) return
  const stuck = await db.assets.filter((record) => record.cloudStatus === 'uploading').toArray()
  for (const record of stuck) {
    await db.assets.update(record.id, { cloudStatus: 'failed' })
  }
}
