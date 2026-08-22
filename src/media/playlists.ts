// 歌单系统(方案一):歌单直接由画布图结构派生,不建独立数据模型。
//
// 规则:
// 1. 歌单名 = 一个"命名文本节点":kind === 'text'、文本非空、无入边、
//    且恰好有一条出边指向音频节点。被其他节点指向的文本节点视为注释,不算歌单名。
// 2. 命名文本节点指向的音频节点是歌单首节点(允许指向链中间,即子歌单)。
// 3. 歌单内容 = 从首节点沿"音频 → 音频"出边做深度优先先序遍历:
//    - 分叉处按边的 order 升序,未设置 order 的排在后面,再按 edges 数组顺序(创建顺序)稳定排序;
//    - 环/重复节点只遍历一次,不重复收录;
//    - 同一 assetId 在歌单中只保留第一次出现,其余跳过并告警。
// 4. 经由非音频节点(文本/便签等)的路径不穿透,只有音频节点之间的直连边参与歌单。
// 5. 多个命名文本指向同一个首节点时,按节点创建顺序取第一个名字,其余忽略并告警。
//
// 该模块是纯函数,播放器流式顺序、画布自动切歌、歌单视图都应消费这里的输出,
// 保证同一张图的播放顺序处处一致。

import type { SuqEdge, SuqNode } from '../types'

export interface PlaylistTrack {
  /** 音频节点 id */
  nodeId: string
  assetId: string
  /** 展示名(节点 label) */
  name: string
}

export interface Playlist {
  /** 命名文本节点 id(歌单标识,随项目持久化) */
  id: string
  name: string
  named: boolean
  /** 命名文本节点 id */
  titleNodeId: string | null
  /** 首音频节点 id */
  rootNodeId: string
  tracks: PlaylistTrack[]
  warnings: string[]
}

export interface LinearizeResult {
  assetIds: string[]
  tracks: PlaylistTrack[]
  warnings: string[]
}

function nodeById(nodes: SuqNode[]): Map<string, SuqNode> {
  const map = new Map<string, SuqNode>()
  for (const node of nodes) map.set(node.id, node)
  return map
}

function isAudio(node: SuqNode | undefined): node is SuqNode {
  return node !== undefined && node.data.kind === 'audio' && Boolean(node.data.assetId)
}

/** 某个音频节点的"下一首"候选出边:仅音频目标,按 order 升序(未设置排后)再按创建顺序 */
export function audioNextEdges(edges: SuqEdge[], sourceNodeId: string, nodes: SuqNode[]): SuqEdge[] {
  const byId = nodeById(nodes)
  return edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.source === sourceNodeId && isAudio(byId.get(edge.target)))
    .sort((a, b) => {
      const orderA = a.edge.data.order ?? Number.POSITIVE_INFINITY
      const orderB = b.edge.data.order ?? Number.POSITIVE_INFINITY
      if (orderA !== orderB) return orderA - orderB
      return a.index - b.index
    })
    .map(({ edge }) => edge)
}

/** 从 startNodeId 出发,DFS 先序线性化成歌单顺序 */
export function linearizeFrom(nodes: SuqNode[], edges: SuqEdge[], startNodeId: string): LinearizeResult {
  const byId = nodeById(nodes)
  const start = byId.get(startNodeId)
  if (!isAudio(start)) {
    return { assetIds: [], tracks: [], warnings: [`起点节点 ${startNodeId} 不是有效的音频节点`] }
  }
  const tracks: PlaylistTrack[] = []
  const warnings: string[] = []
  const visited = new Set<string>() // 按 nodeId 防止重复遍历/死循环
  const onPath = new Set<string>() // 当前 DFS 路径,用于检测环
  const seenAssets = new Set<string>() // 按 assetId 去重,歌单内每首歌只出现一次

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    onPath.add(nodeId)
    const node = byId.get(nodeId)
    if (!isAudio(node)) {
      onPath.delete(nodeId)
      return
    }
    const assetId = node.data.assetId as string
    if (seenAssets.has(assetId)) {
      warnings.push(`歌曲「${node.data.label ?? assetId}」已在歌单中,跳过重复节点`)
    } else {
      seenAssets.add(assetId)
      tracks.push({ nodeId, assetId, name: node.data.label ?? '音频' })
    }
    for (const edge of audioNextEdges(edges, nodeId, nodes)) {
      if (onPath.has(edge.target)) {
        warnings.push(`检测到循环连线(${nodeId} → ${edge.target}),已停止该方向的遍历`)
        continue
      }
      visit(edge.target)
    }
    onPath.delete(nodeId)
  }

  visit(startNodeId)
  return { assetIds: tracks.map((track) => track.assetId), tracks, warnings }
}

/** 扫描整张画布,解析出所有命名歌单(按节点创建顺序) */
export function resolvePlaylists(nodes: SuqNode[], edges: SuqEdge[]): Playlist[] {
  const byId = nodeById(nodes)
  const playlists: Playlist[] = []
  const rootToPlaylist = new Map<string, number>() // 首节点 id → playlists 下标

  for (const node of nodes) {
    if (node.data.kind !== 'text') continue
    const name = (node.data.text ?? '').trim()
    if (!name) continue
    // 有入边的文本节点视为注释,不作为歌单名
    if (edges.some((edge) => edge.target === node.id)) continue
    const outEdges = edges.filter((edge) => edge.source === node.id)
    if (outEdges.length !== 1) continue
    const target = byId.get(outEdges[0].target)
    if (!isAudio(target)) continue

    const rootNodeId = target.id
    const existingIndex = rootToPlaylist.get(rootNodeId)
    const { tracks, warnings } = linearizeFrom(nodes, edges, rootNodeId)
    if (existingIndex !== undefined) {
      playlists[existingIndex].warnings.push(
        `多个文本指向同一首节点,歌单名沿用「${playlists[existingIndex].name}」,已忽略「${name}」`,
      )
      continue
    }
    const playlist: Playlist = {
      id: node.id,
      name,
      named: true,
      titleNodeId: node.id,
      rootNodeId,
      tracks,
      warnings,
    }
    playlists.push(playlist)
    rootToPlaylist.set(rootNodeId, playlists.length - 1)
  }
  return playlists
}

/** 在已解析的歌单列表里查找包含某首歌的歌单(多个时取第一个) */
export function findPlaylistByAsset(
  playlists: Playlist[],
  assetId: string | undefined,
): Playlist | undefined {
  if (!assetId) return undefined
  return playlists.find((playlist) =>
    playlist.tracks.some((track) => track.assetId === assetId),
  )
}

// 共享缓存:画布节点/边按引用不可变更新,同一引用命中缓存,
// 避免画布上多个文本节点(及悬浮窗/播放器)重复解析整张图
let cachedNodes: SuqNode[] | null = null
let cachedEdges: SuqEdge[] | null = null
let cachedResult: Playlist[] | null = null

export function resolvePlaylistsCached(nodes: SuqNode[], edges: SuqEdge[]): Playlist[] {
  if (nodes === cachedNodes && edges === cachedEdges && cachedResult) return cachedResult
  cachedNodes = nodes
  cachedEdges = edges
  cachedResult = resolvePlaylists(nodes, edges)
  return cachedResult
}
