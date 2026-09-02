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

describe('复制与粘贴', () => {
  it('复制选中的元素后可粘贴出新元素并保留选中态', () => {
    useCanvasStore.getState().addNodes([node('a'), node('b')])
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n, i) => ({ ...n, selected: i === 0 })),
    })

    useCanvasStore.getState().copySelected()
    expect(useCanvasStore.getState().clipboard?.map((n) => n.id)).toEqual(['a'])

    useCanvasStore.getState().pasteClipboard()
    const state = useCanvasStore.getState()
    expect(state.nodes).toHaveLength(3)
    const pasted = state.nodes.find((n) => n.id !== 'a' && n.id !== 'b')
    expect(pasted).toBeDefined()
    expect(pasted!.selected).toBe(true)
    expect(pasted!.position).toEqual({ x: 28, y: 28 })
    expect(pasted!.data.createdByName).toBe('小苏')
    expect(state.nodes.find((n) => n.id === 'a')?.selected).toBe(false)
  })

  it('粘贴时连带复制被选元素之间的连线并重连新节点', () => {
    const a = node('a')
    const b = node('b')
    useCanvasStore.getState().addNodes([a, b])
    useCanvasStore.setState({
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'styled', data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow: 'end', stroke: '#000', strokeWidth: 1 } } },
        { id: 'e2', source: 'a', target: 'out', type: 'styled', data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow: 'end', stroke: '#000', strokeWidth: 1 } } },
      ],
      nodes: [
        { ...a, selected: true },
        { ...b, selected: true },
        { ...node('out'), selected: false },
      ],
    })

    useCanvasStore.getState().copySelected()
    useCanvasStore.getState().pasteClipboard()

    const state = useCanvasStore.getState()
    const ids = new Set(state.nodes.map((n) => n.id))
    const pastedIds = state.nodes.filter((n) => n.selected).map((n) => n.id)
    const pasteEdge = state.edges.find((e) => e.id !== 'e1' && e.id !== 'e2')
    expect(pasteEdge).toBeDefined()
    expect(pasteEdge!.source).toBe(pastedIds[0])
    expect(pasteEdge!.target).toBe(pastedIds[1])
    expect(ids.has(pasteEdge!.source)).toBe(true)
    expect(ids.has(pasteEdge!.target)).toBe(true)
    expect(state.edges).toHaveLength(3)
  })

  it('无选中元素时不复制', () => {
    useCanvasStore.getState().addNodes([node('a')])
    useCanvasStore.getState().copySelected()
    expect(useCanvasStore.getState().clipboard).toBeNull()
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

describe('分组/容器（node_grouping）', () => {
  function select(...ids: string[]) {
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    })
  }

  it('groupSelected 把多选节点成组并转为相对坐标', () => {
    useCanvasStore.getState().addNodes([
      { ...node('a'), position: { x: 10, y: 10 } },
      { ...node('b'), position: { x: 200, y: 120 } },
    ])
    select('a', 'b')
    useCanvasStore.getState().groupSelected()

    const state = useCanvasStore.getState()
    const group = state.nodes.find((n) => n.data.isGroup)
    expect(group).toBeDefined()
    expect(group!.type).toBe('group')
    const children = state.nodes.filter((n) => n.parentId === group!.id)
    expect(children).toHaveLength(2)
    for (const c of children) {
      expect(c.extent).toBe('parent')
      expect(c.position.x).toBeGreaterThanOrEqual(0)
      expect(c.position.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('dissolveGroup 解散后移除分组节点并保留成员', () => {
    useCanvasStore.getState().addNodes([
      { ...node('a'), position: { x: 10, y: 10 } },
      { ...node('b'), position: { x: 200, y: 120 } },
    ])
    select('a', 'b')
    useCanvasStore.getState().groupSelected()
    const groupId = useCanvasStore.getState().nodes.find((n) => n.data.isGroup)!.id
    useCanvasStore.getState().dissolveGroup(groupId)

    const state = useCanvasStore.getState()
    expect(state.nodes.find((n) => n.data.isGroup)).toBeUndefined()
    expect(state.nodes).toHaveLength(2)
    expect(state.nodes.every((n) => !n.data.isGroup)).toBe(true)
  })

  it('删除分组节点会连带删除其子孙与连线', () => {
    useCanvasStore.getState().addNodes([
      { ...node('a'), position: { x: 10, y: 10 } },
      { ...node('b'), position: { x: 200, y: 120 } },
    ])
    select('a', 'b')
    useCanvasStore.getState().groupSelected()
    const state0 = useCanvasStore.getState()
    const groupId = state0.nodes.find((n) => n.data.isGroup)!.id
    const childId = state0.nodes.find((n) => n.parentId === groupId)!.id
    useCanvasStore.setState({
      edges: [
        { id: 'e', source: childId, target: 'ghost', type: 'styled', data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow: 'end', stroke: '#000', strokeWidth: 1 } } },
      ],
    })
    // 模拟按下 Delete：ReactFlow 派发 remove change 给父节点
    useCanvasStore.getState().onNodesChange([{ id: groupId, type: 'remove' }])
    const state = useCanvasStore.getState()
    expect(state.nodes.find((n) => n.data.isGroup)).toBeUndefined()
    expect(state.nodes.find((n) => n.parentId === groupId)).toBeUndefined()
    expect(state.edges).toHaveLength(0)
  })

  it('setNodeLocked 写入 locked 并置 draggable=false', () => {
    useCanvasStore.getState().addNodes([node('a')])
    useCanvasStore.getState().setNodeLocked('a', true)
    const n = useCanvasStore.getState().nodes.find((x) => x.id === 'a')!
    expect(n.data.locked).toBe(true)
    expect(n.draggable).toBe(false)
    useCanvasStore.getState().setNodeLocked('a', false)
    const n2 = useCanvasStore.getState().nodes.find((x) => x.id === 'a')!
    expect(n2.data.locked).toBe(false)
    expect(n2.draggable).toBe(true)
  })
})
