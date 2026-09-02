import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Viewport } from '@xyflow/react'
import { genUuid } from '../utils/uuid'
import { db } from '../db/db'
import { normalizeGroupHierarchy } from '../canvas/groups'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useAuthStore } from '../store/authStore'
import { toast } from '../store/uiStore'
import { useUploadStore } from '../store/uploadStore'
import { upsertProjectToCloud } from '../sync/cloudSync'
import type { MediaKind, SuqEdge, SuqNode } from '../types'

const FORMAT = 'sqcanvas'
const VERSION = 1

interface AssetExportMeta {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  hasThumbnail: boolean
}

interface ProjectExportJson {
  format: string
  version: number
  project: { name: string }
  viewport: Viewport
  nodes: SuqNode[]
  edges: SuqEdge[]
  assets: AssetExportMeta[]
}

export async function exportProjectToBlob(
  projectName: string,
  nodes: SuqNode[],
  edges: SuqEdge[],
  viewport: Viewport,
): Promise<Blob> {
  const assetIds = new Set<string>()
  for (const n of nodes) {
    if (n.data?.assetId) assetIds.add(n.data.assetId)
    if (n.data?.coverAssetId) assetIds.add(n.data.coverAssetId)
  }

  const files: Record<string, Uint8Array> = {}
  const assets: AssetExportMeta[] = []
  for (const id of assetIds) {
    const record = await db.assets.get(id)
    if (!record) continue
    files[`assets/${id}.bin`] = new Uint8Array(await record.blob.arrayBuffer())
    if (record.thumbnail) {
      files[`assets/${id}.thumb`] = new Uint8Array(await record.thumbnail.arrayBuffer())
    }
    assets.push({
      id: record.id,
      name: record.name,
      mime: record.mime,
      size: record.size,
      kind: record.kind,
      hasThumbnail: !!record.thumbnail,
    })
  }

  const json: ProjectExportJson = {
    format: FORMAT,
    version: VERSION,
    project: { name: projectName },
    viewport,
    nodes,
    edges,
    assets,
  }
  files['project.json'] = strToU8(JSON.stringify(json))
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(u8.byteLength)
  new Uint8Array(copy).set(u8)
  return copy
}

export function downloadBlob(blob: Blob, filename: string): void {  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportCurrentProject(): Promise<void> {
  const project = useProjectStore.getState()
  if (!project.loaded) return
  const { nodes, edges, viewport } = useCanvasStore.getState()
  try {
    const blob = await exportProjectToBlob(project.projectName, nodes, edges, viewport)
    const safeName = (project.projectName || '未命名项目').replace(/[\\/:*?"<>|]/g, '_')
    downloadBlob(blob, `${safeName}.sqcanvas`)
    toast('项目已导出', 'success')
  } catch (err) {
    console.error(err)
    toast('导出失败', 'error')
  }
}

export async function importProjectFile(file: File): Promise<void> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(buf)
  } catch {
    throw new Error('文件损坏或不是有效的 SuQCanvas 项目')
  }

  const raw = unzipped['project.json']
  if (!raw) throw new Error('缺少 project.json，文件无效')

  let json: ProjectExportJson
  try {
    json = JSON.parse(strFromU8(raw)) as ProjectExportJson
  } catch {
    throw new Error('project.json 解析失败')
  }
  if (json.format !== FORMAT) throw new Error('不是 SuQCanvas 项目文件')
  if (json.version > VERSION) throw new Error(`项目版本 (v${json.version}) 高于当前支持的版本 (v${VERSION})`)

  for (const asset of json.assets ?? []) {
    const data = unzipped[`assets/${asset.id}.bin`]
    if (!data) continue
    const existing = await db.assets.get(asset.id)
    if (!existing) {
      const thumbData = unzipped[`assets/${asset.id}.thumb`]
      await db.assets.put({
        id: asset.id,
        name: asset.name,
        mime: asset.mime,
        size: asset.size,
        kind: asset.kind,
        blob: new Blob([toArrayBuffer(data)], { type: asset.mime || 'application/octet-stream' }),
        thumbnail: thumbData ? new Blob([toArrayBuffer(thumbData)], { type: 'image/jpeg' }) : undefined,
      })
    }
  }

  const now = Date.now()
  const id = genUuid()
  const projectName = json.project?.name || '导入的项目'
  // 导入归一化：父节点先于子节点排序，并把 parentId 指向缺失节点的“孤儿”降级为顶层，
  // 完整重建分组嵌套结构（无 schema 变更，VERSION 维持 1）。
  const normalizedNodes = normalizeGroupHierarchy(json.nodes ?? [])
  const record = {
    id,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    graph: { nodes: normalizedNodes, edges: json.edges ?? [] },
    viewport: json.viewport ?? { x: 0, y: 0, zoom: 1 },
  }

  const authed = useAuthStore.getState().user !== null
  if (authed) {
    await upsertProjectToCloud(record)
    // 复用带状态追踪的上传链路：失败的资源会在文件列表标出，可点击重新上传
    for (const asset of json.assets ?? []) {
      if (!unzipped[`assets/${asset.id}.bin`]) continue
      await useUploadStore.getState().runCloudUpload(asset.id)
    }
  } else {
    await db.projects.add(record)
  }
  await useProjectStore.getState().loadProject(id)
  await useProjectStore.getState().saveNow()
  toast('项目导入成功', 'success')
}
