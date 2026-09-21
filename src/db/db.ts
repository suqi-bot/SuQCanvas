import Dexie, { type EntityTable } from 'dexie'
import type { MediaKind, SuqEdge, SuqNode } from '../types'
import type { Viewport } from '@xyflow/react'
import type { AiTask } from '../ai/taskTypes'

/** 云端上传状态：上传中 / 失败（可重试）/ 已成功 */
export type CloudUploadState = 'uploading' | 'failed' | 'done'

export interface AssetRecord {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  blob: Blob
  thumbnail?: Blob
  orphanedAt?: number
  /** 云端上传状态，仅在线版写入；失败后可在文件管理中重新上传 */
  cloudStatus?: CloudUploadState
}

export interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  graph: { nodes: SuqNode[]; edges: SuqEdge[] }
  viewport: Viewport
}

/** Desktop-only association, kept outside exported/local project data. */
export interface DesktopCloudLink {
  localProjectId: string
  owner: string
  projectId: string
  updatedAt: string | null
  name: string
  localName: string
}

/** ali-oss 分片上传断点续传数据，不含不可序列化的 file 引用 */
export interface OssCheckpointData {
  /** OSS object key */
  name: string
  fileSize: number
  partSize: number
  uploadId: string
  doneParts: Array<{ number: number; etag: string }>
}

export interface UploadCheckpointRecord {
  /** 对应 AssetRecord.id，一个素材仅保留一条断点 */
  assetId: string
  /** 保存时的 OSS object key，与当前不一致则断点作废 */
  key: string
  /** 保存时的文件大小，与当前不一致则断点作废 */
  fileSize: number
  updatedAt: number
  checkpoint: OssCheckpointData
}

export const db = new Dexie('suqcanvas') as Dexie & {
  assets: EntityTable<AssetRecord, 'id'>
  projects: EntityTable<ProjectRecord, 'id'>
  uploadCheckpoints: EntityTable<UploadCheckpointRecord, 'assetId'>
  desktopCloudLinks: EntityTable<DesktopCloudLink, 'localProjectId'>
  aiTasks: EntityTable<AiTask, 'id'>
}

db.version(1).stores({
  assets: 'id, kind, name',
  projects: 'id, updatedAt',
})
db.version(2).stores({
  assets: 'id, kind, name',
  projects: 'id, updatedAt',
  uploadCheckpoints: 'assetId',
})
db.version(3).stores({ desktopCloudLinks: 'localProjectId' })
db.version(4).stores({ aiTasks: 'id, projectId, owner, state, createdAt' })

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist()
    }
  } catch {
    // ignore
  }
  return false
}

const GC_RETENTION_MS = 24 * 60 * 60 * 1000

export async function gcAssets(): Promise<void> {
  const projects = await db.projects.toArray()
  const referenced = new Set<string>()
  for (const p of projects) {
    for (const n of p.graph.nodes) {
      if (n.data?.assetId) referenced.add(n.data.assetId)
      if (n.data?.coverAssetId) referenced.add(n.data.coverAssetId)
    }
  }
  const now = Date.now()
  for (const task of await db.aiTasks.where('state').anyOf('ready', 'running', 'paused', 'error').toArray()) {
    for (const node of task.resultNodes ?? []) if (node.data.assetId) referenced.add(node.data.assetId)
  }
  const assets = await db.assets.toArray()
  for (const a of assets) {
    if (referenced.has(a.id)) {
      if (a.orphanedAt) await db.assets.update(a.id, { orphanedAt: undefined })
    } else if (a.orphanedAt && now - a.orphanedAt > GC_RETENTION_MS) {
      await db.assets.delete(a.id)
      await db.uploadCheckpoints.delete(a.id)
    } else if (!a.orphanedAt) {
      await db.assets.update(a.id, { orphanedAt: now })
    }
  }
}
