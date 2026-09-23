import { expect, test } from 'vitest'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'
import { linearizeNeteaseFrom } from './neteaseFlow'

function song(nodeId: string, id: string): SuqNode {
  return { id: nodeId, type: 'netease', position: { x: 0, y: 0 }, data: { kind: 'netease', neteaseId: id, label: id } }
}

function edge(id: string, source: string, target: string, order?: number): SuqEdge {
  return { id, source, target, type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE }, ...(order === undefined ? {} : { order }) } }
}

test('网易云连线按边顺序和 DFS 播放，环和重复歌曲只播放一次', () => {
  const nodes = [song('a', '1'), song('b', '2'), song('c', '3'), song('d', '2'), song('e', '5')]
  const edges = [
    edge('ab', 'a', 'b', 2), edge('ac', 'a', 'c', 1), edge('cd', 'c', 'd'),
    edge('de', 'd', 'e'), edge('ea', 'e', 'a'),
  ]
  expect(linearizeNeteaseFrom(nodes, edges, 'a').map((track) => track.id)).toEqual(['1', '3', '2', '5'])
})

test('从中间节点播放只跟随下游网易云歌曲，不穿过其他节点', () => {
  const nodes = [song('a', '1'), song('b', '2'), song('c', '3'), {
    id: 't', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', label: '说明' },
  } satisfies SuqNode]
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ct', 'c', 't'), edge('ta', 't', 'a')]
  expect(linearizeNeteaseFrom(nodes, edges, 'b').map((track) => track.id)).toEqual(['2', '3'])
  expect(linearizeNeteaseFrom(nodes, edges, 't')).toEqual([])
})
