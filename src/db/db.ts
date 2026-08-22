import Dexie, { type EntityTable } from 'dexie'
import type { MediaKind, SuqEdge, SuqNode } from '../types'
import type { Viewport } from '@xyflow/react'

export interface AssetRecord {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  blob: Blob
  thumbnail?: Blob
}

export interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  graph: { nodes: SuqNode[]; edges: SuqEdge[] }
  viewport: Viewport
}

export const db = new Dexie('suqcanvas') as Dexie & {
  assets: EntityTable<AssetRecord, 'id'>
  projects: EntityTable<ProjectRecord, 'id'>
}

db.version(1).stores({
  assets: 'id, kind, name',
  projects: 'id, updatedAt',
})

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

export async function gcAssets(): Promise<void> {
  const projects = await db.projects.toArray()
  const referenced = new Set<string>()
  for (const p of projects) {
    for (const n of p.graph.nodes) {
      if (n.data?.assetId) referenced.add(n.data.assetId)
      if (n.data?.coverAssetId) referenced.add(n.data.coverAssetId)
    }
  }
  const assets = await db.assets.toArray()
  for (const a of assets) {
    if (!referenced.has(a.id)) await db.assets.delete(a.id)
  }
}
