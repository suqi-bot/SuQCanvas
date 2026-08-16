import type { Viewport } from '@xyflow/react'
import { db, type ProjectRecord } from '../db/db'
import type { MediaKind, SuqEdge, SuqNode } from '../types'
import { supabase } from './supabaseClient'

export interface CloudAsset {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  oss_key: string
  oss_thumb_key: string | null
  has_thumbnail: boolean
  created_at: string
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** 同步素材元数据到云端 assets 表 */
export async function upsertAssetMetaToCloud(
  meta: { id: string; name: string; mime: string; size: number; kind: MediaKind; hasThumbnail?: boolean },
  ossKey: string,
  ossThumbKey?: string,
): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const { error } = await supabase.from('assets').upsert({
    id: meta.id,
    user_id: userId,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    kind: meta.kind,
    oss_key: ossKey,
    oss_thumb_key: ossThumbKey ?? null,
    has_thumbnail: meta.hasThumbnail ?? false,
  })
  if (error) console.warn('同步素材元数据到云端失败:', error.message)
}

/** 删除云端素材元数据 */
export async function deleteAssetFromCloud(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) console.warn('删除云端素材失败:', error.message)
}

/** 按 id 列表查询云端素材 */
export async function fetchCloudAssets(ids: string[]): Promise<CloudAsset[]> {
  if (!supabase || ids.length === 0) return []
  const { data, error } = await supabase.from('assets').select('*').in('id', ids)
  if (error) {
    console.warn('拉取云端素材失败:', error.message)
    return []
  }
  return (data ?? []) as CloudAsset[]
}

export interface CloudProject {
  id: string
  name: string
  graph: { nodes: SuqNode[]; edges: SuqEdge[] }
  viewport: Viewport
  created_at: string
  updated_at: string
}

function toCloud(p: ProjectRecord): CloudProject {
  return {
    id: p.id,
    name: p.name,
    graph: p.graph,
    viewport: p.viewport,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
  }
}

function fromCloud(c: CloudProject): ProjectRecord {
  return {
    id: c.id,
    name: c.name,
    graph: c.graph ?? { nodes: [], edges: [] },
    viewport: c.viewport ?? { x: 0, y: 0, zoom: 1 },
    createdAt: new Date(c.created_at).getTime(),
    updatedAt: new Date(c.updated_at).getTime(),
  }
}

function ts(p: { updatedAt?: number; updated_at?: string }): number {
  if (typeof p.updatedAt === 'number') return p.updatedAt
  return new Date(p.updated_at ?? 0).getTime()
}

export async function fetchCloudProjects(): Promise<CloudProject[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('projects').select('*')
  if (error) {
    console.warn('拉取云端项目失败:', error.message)
    return []
  }
  return (data ?? []) as CloudProject[]
}

export async function fetchCloudProject(id: string): Promise<CloudProject | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
  if (error) {
    console.warn('拉取云端项目失败:', error.message)
    return null
  }
  return (data ?? null) as CloudProject | null
}

export async function upsertProjectToCloud(p: ProjectRecord): Promise<boolean> {
  if (!supabase) return false
  const userId = await currentUserId()
  if (!userId) return false
  const { error } = await supabase.from('projects').upsert({ ...toCloud(p), user_id: userId })
  if (error) {
    console.warn('推送项目到云端失败:', error.message)
    return false
  }
  return true
}

export async function updateProjectNameInCloud(id: string, name: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('projects').update({ name }).eq('id', id)
  if (error) console.warn('云端重命名失败:', error.message)
}

export async function deleteProjectFromCloud(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) console.warn('云端删除失败:', error.message)
}

/**
 * 合并本地与云端项目列表（云为主）：
 * 1. 本地有、云端无 → 上传迁移到云端
 * 2. 云端有、本地无 → 下载缓存到本地
 * 3. 两边都有 → 取 updated_at 较新的一方，回写较旧的一方
 */
export async function syncProjectList(): Promise<ProjectRecord[]> {
  const local = await db.projects.toArray()
  const cloud = await fetchCloudProjects()
  if (cloud.length === 0 && local.length > 0 && supabase) {
    for (const p of local) {
      await upsertProjectToCloud(p)
    }
    return [...local].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const merged = new Map<string, ProjectRecord>()
  for (const c of cloud) {
    merged.set(c.id, fromCloud(c))
  }
  for (const l of local) {
    const existing = merged.get(l.id)
    if (!existing) {
      await upsertProjectToCloud(l)
      merged.set(l.id, l)
    } else if (l.updatedAt > existing.updatedAt) {
      await upsertProjectToCloud(l)
      merged.set(l.id, l)
    } else if (existing.updatedAt > l.updatedAt) {
      await db.projects.put(existing)
      merged.set(l.id, existing)
    }
  }

  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 加载项目：取本地与云端较新的版本 */
export async function loadProjectBest(id: string): Promise<ProjectRecord | null> {
  const local = await db.projects.get(id)
  const cloud = await fetchCloudProject(id)
  if (!cloud) return local ?? null
  if (!local) {
    const rec = fromCloud(cloud)
    await db.projects.put(rec)
    return rec
  }
  if (ts(cloud) > local.updatedAt) {
    const rec = fromCloud(cloud)
    await db.projects.put(rec)
    return rec
  }
  return local
}
