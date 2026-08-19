import { beforeEach, describe, expect, it } from 'vitest'
import type { SuqNode } from '../types'
import { useLanStore } from './lanStore'
import { useCanvasStore } from './canvasStore'

function node(id: string): SuqNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label: id },
  }
}

beforeEach(() => {
  useCanvasStore.getState().reset()
  useCanvasStore.getState().clearHistory()
  useLanStore.setState({ selfId: 'user-1', name: '小苏' })
})

describe('画布元素元数据', () => {
  it('新增和复制元素记录当前插入者', () => {
    useCanvasStore.getState().addNodes([node('a')])
    const added = useCanvasStore.getState().nodes[0]
    expect(added.data.createdById).toBe('user-1')
    expect(added.data.createdByName).toBe('小苏')
    expect(added.data.createdAt).toEqual(expect.any(Number))

    useLanStore.setState({ selfId: 'user-2', name: '阿明' })
    useCanvasStore.getState().duplicateNode('a')
    expect(useCanvasStore.getState().nodes[1].data.createdByName).toBe('阿明')
  })
})

describe('元素层级', () => {
  it('支持置顶、上移、下移和置底', () => {
    useCanvasStore.getState().addNodes([node('a'), node('b'), node('c')])
    const order = () =>
      [...useCanvasStore.getState().nodes]
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((item) => item.id)

    useCanvasStore.getState().changeNodeLayer('a', 'front')
    expect(order()).toEqual(['b', 'c', 'a'])
    useCanvasStore.getState().changeNodeLayer('a', 'backward')
    expect(order()).toEqual(['b', 'a', 'c'])
    useCanvasStore.getState().changeNodeLayer('b', 'forward')
    expect(order()).toEqual(['a', 'b', 'c'])
    useCanvasStore.getState().changeNodeLayer('c', 'back')
    expect(order()).toEqual(['c', 'a', 'b'])
  })

  it('支持手动设置层级数值并限制为整数范围', () => {
    useCanvasStore.getState().addNodes([node('a'), node('b')])

    useCanvasStore.getState().setNodeZIndex('a', 42.8)
    expect(useCanvasStore.getState().nodes.find((item) => item.id === 'a')?.zIndex).toBe(42)

    useCanvasStore.getState().setNodeZIndex('a', -3)
    expect(useCanvasStore.getState().nodes.find((item) => item.id === 'a')?.zIndex).toBe(0)

    useCanvasStore.getState().setNodeZIndex('a', 20_000)
    expect(useCanvasStore.getState().nodes.find((item) => item.id === 'a')?.zIndex).toBe(9999)
  })
})

describe('资源删除', () => {
  it('删除资源关联的所有节点和连线', () => {
    const assetNodeA = node('asset-a-1')
    assetNodeA.data.assetId = 'asset-a'
    const assetNodeA2 = node('asset-a-2')
    assetNodeA2.data.assetId = 'asset-a'
    const otherNode = node('other')
    otherNode.data.assetId = 'asset-b'
    useCanvasStore.setState({
      nodes: [assetNodeA, assetNodeA2, otherNode],
      edges: [
        { id: 'remove-edge', source: 'asset-a-1', target: 'other', type: 'styled', data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow: 'end', stroke: '#000', strokeWidth: 1 } } },
        { id: 'keep-edge', source: 'other', target: 'other', type: 'styled', data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow: 'end', stroke: '#000', strokeWidth: 1 } } },
      ],
    })

    useCanvasStore.getState().removeAssets(['asset-a'])

    expect(useCanvasStore.getState().nodes.map((item) => item.id)).toEqual(['other'])
    expect(useCanvasStore.getState().edges.map((item) => item.id)).toEqual(['keep-edge'])
  })
})
