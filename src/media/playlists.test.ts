import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'
import {
  audioNextEdges,
  findPlaylistByAsset,
  linearizeFrom,
  resolvePlaylists,
  resolvePlaylistsCached,
} from './playlists'

function audio(id: string, assetId: string, label = assetId): SuqNode {
  return {
    id,
    type: 'audio',
    position: { x: 0, y: 0 },
    data: { kind: 'audio', assetId, label },
  }
}

function textNode(id: string, content: string): SuqNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label: '文本', text: content },
  }
}

function edge(id: string, source: string, target: string, order?: number): SuqEdge {
  return {
    id,
    source,
    target,
    type: 'styled',
    data: { style: { ...DEFAULT_EDGE_STYLE }, ...(order !== undefined ? { order } : {}) },
  }
}

describe('linearizeFrom', () => {
  it('单链顺序播放', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    expect(linearizeFrom(nodes, edges, 'a').assetIds).toEqual(['A', 'B', 'C'])
  })

  it('分叉按 DFS 先序:先走完第一条分支再回溯第二条', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('d', 'D'), audio('c', 'C'), audio('e', 'E')]
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
      edge('e3', 'b', 'd'),
      edge('e4', 'c', 'e'),
    ]
    expect(linearizeFrom(nodes, edges, 'a').assetIds).toEqual(['A', 'B', 'D', 'C', 'E'])
  })

  it('边序号覆盖创建顺序', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C')]
    const edges = [edge('e1', 'a', 'b', 2), edge('e2', 'a', 'c', 1)]
    expect(linearizeFrom(nodes, edges, 'a').assetIds).toEqual(['A', 'C', 'B'])
  })

  it('未设置序号的边排在有序号之后,同序号按创建顺序', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C'), audio('d', 'D')]
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c', 1),
      edge('e3', 'a', 'd', 1),
    ]
    expect(linearizeFrom(nodes, edges, 'a').assetIds).toEqual(['A', 'C', 'D', 'B'])
  })

  it('环只收录一次并给出告警', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')]
    const result = linearizeFrom(nodes, edges, 'a')
    expect(result.assetIds).toEqual(['A', 'B', 'C'])
    expect(result.warnings.some((warning) => warning.includes('循环'))).toBe(true)
  })

  it('自环不死循环', () => {
    const nodes = [audio('a', 'A')]
    const edges = [edge('e1', 'a', 'a')]
    const result = linearizeFrom(nodes, edges, 'a')
    expect(result.assetIds).toEqual(['A'])
    expect(result.warnings.some((warning) => warning.includes('循环'))).toBe(true)
  })

  it('同一 assetId 出现多次只保留第一次,但继续遍历重复节点的子节点', () => {
    const nodes = [
      audio('a', 'A'),
      audio('b', 'B'),
      audio('d', 'D'),
      audio('c', 'A', 'A 的另一节点'),
      audio('e', 'E'),
    ]
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
      edge('e3', 'b', 'd'),
      edge('e4', 'c', 'e'),
    ]
    const result = linearizeFrom(nodes, edges, 'a')
    expect(result.assetIds).toEqual(['A', 'B', 'D', 'E'])
    expect(result.warnings.some((warning) => warning.includes('跳过重复节点'))).toBe(true)
  })

  it('从链中间节点出发得到子歌单', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    expect(linearizeFrom(nodes, edges, 'b').assetIds).toEqual(['B', 'C'])
  })

  it('经由非音频节点的路径不穿透', () => {
    const nodes = [audio('a', 'A'), textNode('t', '说明'), audio('b', 'B')]
    const edges = [edge('e1', 'a', 't'), edge('e2', 't', 'b')]
    expect(linearizeFrom(nodes, edges, 'a').assetIds).toEqual(['A'])
  })

  it('无效起点返回空与告警', () => {
    const nodes = [textNode('t', '说明')]
    const result = linearizeFrom(nodes, [], 't')
    expect(result.assetIds).toEqual([])
    expect(result.warnings.length).toBe(1)
  })
})

describe('audioNextEdges', () => {
  it('过滤非音频目标并按 order 排序', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C'), textNode('t', '注')]
    const edges = [
      edge('e1', 'a', 't'),
      edge('e2', 'a', 'b'),
      edge('e3', 'a', 'c', 1),
    ]
    const next = audioNextEdges(edges, 'a', nodes)
    expect(next.map((item) => item.id)).toEqual(['e3', 'e2'])
  })
})

describe('resolvePlaylists', () => {
  it('命名文本指向首节点,解析出歌单', () => {
    const nodes = [textNode('t', '我的歌单'), audio('a', 'A'), audio('b', 'B')]
    const edges = [edge('e0', 't', 'a'), edge('e1', 'a', 'b')]
    const playlists = resolvePlaylists(nodes, edges)
    expect(playlists).toHaveLength(1)
    expect(playlists[0]).toMatchObject({
      id: 't',
      name: '我的歌单',
      named: true,
      titleNodeId: 't',
      rootNodeId: 'a',
    })
    expect(playlists[0].tracks.map((track) => track.assetId)).toEqual(['A', 'B'])
  })

  it('命名文本指向链中间节点,得到子歌单', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B'), audio('c', 'C'), textNode('t', '副歌单')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e0', 't', 'b')]
    const playlists = resolvePlaylists(nodes, edges)
    expect(playlists).toHaveLength(1)
    expect(playlists[0].rootNodeId).toBe('b')
    expect(playlists[0].tracks.map((track) => track.assetId)).toEqual(['B', 'C'])
  })

  it('有入边的文本节点视为注释,不算歌单名', () => {
    const nodes = [audio('a', 'A'), textNode('t', '注释'), audio('b', 'B')]
    const edges = [edge('e1', 'a', 't'), edge('e2', 't', 'b')]
    expect(resolvePlaylists(nodes, edges)).toHaveLength(0)
  })

  it('多出边的文本节点不算歌单名', () => {
    const nodes = [textNode('t', '名字'), audio('a', 'A'), audio('b', 'B')]
    const edges = [edge('e0', 't', 'a'), edge('e1', 't', 'b')]
    expect(resolvePlaylists(nodes, edges)).toHaveLength(0)
  })

  it('空文本不算歌单名', () => {
    const nodes = [textNode('t', '   '), audio('a', 'A')]
    const edges = [edge('e0', 't', 'a')]
    expect(resolvePlaylists(nodes, edges)).toHaveLength(0)
  })

  it('指向非音频节点的文本不算歌单名', () => {
    const nodes = [textNode('t', '标题'), textNode('x', '正文')]
    const edges = [edge('e0', 't', 'x')]
    expect(resolvePlaylists(nodes, edges)).toHaveLength(0)
  })

  it('多个文本指向同一首节点,取第一个名字并告警', () => {
    const nodes = [textNode('t1', '名字一'), textNode('t2', '名字二'), audio('a', 'A')]
    const edges = [edge('e0', 't1', 'a'), edge('e1', 't2', 'a')]
    const playlists = resolvePlaylists(nodes, edges)
    expect(playlists).toHaveLength(1)
    expect(playlists[0].name).toBe('名字一')
    expect(playlists[0].warnings.some((warning) => warning.includes('多个文本'))).toBe(true)
  })

  it('不同首节点解析出多个独立歌单,允许共享节点', () => {
    const nodes = [
      textNode('t1', '歌单一'),
      textNode('t2', '歌单二'),
      audio('a', 'A'),
      audio('b', 'B'),
      audio('c', 'C'),
    ]
    const edges = [edge('e0', 't1', 'a'), edge('e1', 'a', 'b'), edge('e2', 't2', 'b'), edge('e3', 'b', 'c')]
    const playlists = resolvePlaylists(nodes, edges)
    expect(playlists).toHaveLength(2)
    expect(playlists[0].tracks.map((track) => track.assetId)).toEqual(['A', 'B', 'C'])
    expect(playlists[1].tracks.map((track) => track.assetId)).toEqual(['B', 'C'])
  })

  it('无名歌单不生成(只有命名文本才产生歌单)', () => {
    const nodes = [audio('a', 'A'), audio('b', 'B')]
    const edges = [edge('e1', 'a', 'b')]
    expect(resolvePlaylists(nodes, edges)).toHaveLength(0)
  })
})

describe('resolvePlaylistsCached', () => {
  it('相同 nodes/edges 引用命中缓存,不同引用重新解析', () => {
    const nodes = [textNode('t', '歌单'), audio('a', 'A')]
    const edges = [edge('e0', 't', 'a')]
    const first = resolvePlaylistsCached(nodes, edges)
    expect(resolvePlaylistsCached(nodes, edges)).toBe(first)
    const rebuilt = resolvePlaylistsCached([...nodes], edges)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt).toHaveLength(1)
  })
})

describe('findPlaylistByAsset', () => {
  it('返回包含该歌曲的歌单,不存在时返回 undefined', () => {
    const nodes = [textNode('t', '我的歌单'), audio('a', 'A'), audio('b', 'B')]
    const edges = [edge('e0', 't', 'a'), edge('e1', 'a', 'b')]
    const playlists = resolvePlaylists(nodes, edges)
    expect(findPlaylistByAsset(playlists, 'B')?.name).toBe('我的歌单')
    expect(findPlaylistByAsset(playlists, 'A')?.name).toBe('我的歌单')
    expect(findPlaylistByAsset(playlists, '不存在')).toBeUndefined()
    expect(findPlaylistByAsset(playlists, undefined)).toBeUndefined()
  })
})
