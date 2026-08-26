import type { MediaKind, SuqNode } from '../types'
import type { AssetRecord } from '../db/db'

export interface ManagedFile {
  assetId: string
  name: string
  kind: MediaKind
  mime: string
  size: number
  nodes: SuqNode[]
}

export function isMp3(file: ManagedFile): boolean {
  return file.kind === 'audio' && (file.mime.toLowerCase() === 'audio/mpeg' || /\.mp3$/i.test(file.name))
}

/** 由画布节点 + 素材记录聚合出可管理的文件列表（每个 assetId 一份） */
export function collectFiles(nodes: SuqNode[], records: Map<string, AssetRecord>): ManagedFile[] {
  const grouped = new Map<string, SuqNode[]>()
  for (const node of nodes) {
    if (!node.data.assetId) continue
    const list = grouped.get(node.data.assetId) ?? []
    list.push(node)
    grouped.set(node.data.assetId, list)
  }
  return [...grouped.entries()].map(([assetId, linkedNodes]) => {
    const node = linkedNodes[0]
    const record = records.get(assetId)
    return {
      assetId,
      name: record?.name ?? node.data.label ?? '未命名文件',
      kind: record?.kind ?? node.data.kind,
      mime: record?.mime ?? node.data.mime ?? '',
      size: record?.size ?? node.data.fileSize ?? 0,
      nodes: linkedNodes,
    }
  })
}
