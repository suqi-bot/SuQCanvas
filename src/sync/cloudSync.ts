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

/** 当前是否已登录云端账号（游客/未登录时不执行任何云同步） */
export async function isCloudAuthed(): Promise<boolean> {
  return (await currentUserId()) !== null
}

/** 同步素材元数据到云端 assets 表，返回是否成功 */
export async function upsertAssetMetaToCloud(
  meta: { id: string; name: string; mime: string; size: number; kind: MediaKind; hasThumbnail?: boolean },
  ossKey: string,
  ossThumbKey?: string,
): Promise<boolean> {
  if (!supabase) return false
  const userId = await currentUserId()
  if (!userId) return false
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
  if (error) {
    console.warn('同步素材元数据到云端失败:', error.message)
    return false
  }
  return true
}

/** 删除云端素材元数据 */
export async function deleteAssetFromCloud(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) console.warn('删除云端素材失败:', error.message)
}

/** 按 id 列表查询云端素材 */
export async function fetchCloudAssets(ids: string[]): Promise<CloudAsset[]> {
  if (!supabase || ids.length === 0 || !(await isCloudAuthed())) return []
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

export async function fetchCloudProjects(): Promise<CloudProject[]> {
  if (!supabase || !(await isCloudAuthed())) return []
  const { data, error } = await supabase.from('projects').select('*')
  if (error) {
    console.warn('拉取云端项目失败:', error.message)
    return []
  }
  return (data ?? []) as CloudProject[]
}

export async function fetchCloudProject(id: string): Promise<CloudProject | null> {
  if (!supabase || !(await isCloudAuthed())) return null
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
  if (!supabase || !(await isCloudAuthed())) return
  const { error } = await supabase.from('projects').update({ name }).eq('id', id)
  if (error) console.warn('云端重命名失败:', error.message)
}

export async function deleteProjectFromCloud(id: string): Promise<void> {
  if (!supabase || !(await isCloudAuthed())) return
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) console.warn('云端删除失败:', error.message)
}

/**
 * 项目列表：登录后仅来自云端，游客/未登录仅来自本地，两者互不串通。
 */
export async function syncProjectList(): Promise<ProjectRecord[]> {
  if (!(await isCloudAuthed())) {
    const local = await db.projects.toArray()
    return [...local].sort((a, b) => b.updatedAt - a.updatedAt)
  }
  const cloud = await fetchCloudProjects()
  return cloud.map(fromCloud).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 加载项目：登录后仅从云端读取，游客/未登录仅从本地读取。 */
export async function loadProjectBest(id: string): Promise<ProjectRecord | null> {
  if (!(await isCloudAuthed())) {
    return (await db.projects.get(id)) ?? null
  }
  const cloud = await fetchCloudProject(id)
  return cloud ? fromCloud(cloud) : null
}
