import type { SuqEdge, SuqNode } from '../types'
import { parseNeteaseTarget } from './netease'

export interface NeteaseFlowTrack {
  nodeId: string
  id: string
  name: string
}

function songIdOf(node: SuqNode | undefined): string | null {
  if (node?.data.kind !== 'netease') return null
  const ref = parseNeteaseTarget(node.data.neteaseId)
  return ref?.type === 'song' && ref.id && /^\d+$/.test(ref.id) ? ref.id : null
}

/** 与 MP3 连线歌单相同：只穿过有效歌曲节点，出边按 order 再按创建顺序做 DFS。 */
export function linearizeNeteaseFrom(nodes: SuqNode[], edges: SuqEdge[], startNodeId: string): NeteaseFlowTrack[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!songIdOf(byId.get(startNodeId))) return []

  const tracks: NeteaseFlowTrack[] = []
  const visitedNodes = new Set<string>()
  const seenSongs = new Set<string>()
  const visit = (nodeId: string): void => {
    if (visitedNodes.has(nodeId)) return
    visitedNodes.add(nodeId)
    const node = byId.get(nodeId)
    const id = songIdOf(node)
    if (!node || !id) return
    if (!seenSongs.has(id)) {
      seenSongs.add(id)
      tracks.push({ nodeId, id, name: node.data.label || `网易云歌曲 ${id}` })
    }
    const next = edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.source === nodeId && Boolean(songIdOf(byId.get(edge.target))))
      .sort((a, b) => {
        const orderA = a.edge.data.order ?? Number.POSITIVE_INFINITY
        const orderB = b.edge.data.order ?? Number.POSITIVE_INFINITY
        return orderA - orderB || a.index - b.index
      })
    for (const { edge } of next) visit(edge.target)
  }
  visit(startNodeId)
  return tracks
}
