import { describe, expect, it } from 'vitest'
import type { SuqNode } from '../types'
import {
  clampChildrenToParent,
  collectDescendantIds,
  computeAbsolutePosition,
  computeSelectionBoundingBox,
  dissolveGroup,
  normalizeGroupHierarchy,
  reparentToGroup,
} from './groups'

function leaf(id: string, kind: 'text' = 'text'): SuqNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { kind },
  }
}

function sized(id: string, x: number, y: number, w: number, h: number): SuqNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    style: { width: w, height: h },
    data: { kind: 'text' },
  }
}

describe('groups 纯函数', () => {
  it('computeAbsolutePosition：顶层节点等于自身 position', () => {
    const a = sized('a', 10, 20, 100, 50)
    const byId = new Map([['a', a]])
    expect(computeAbsolutePosition(a, byId)).toEqual({ x: 10, y: 20 })
  })

  it('computeAbsolutePosition：嵌套节点沿祖先链累加', () => {
    const parent = sized('p', 10, 10, 200, 200)
    const child = sized('c', 5, 5, 40, 40)
    child.parentId = 'p'
    child.extent = 'parent'
    const grandchild = sized('g', 2, 2, 10, 10)
    grandchild.parentId = 'c'
    grandchild.extent = 'parent'
    const byId = new Map([
      ['p', parent],
      ['c', child],
      ['g', grandchild],
    ])
    expect(computeAbsolutePosition(child, byId)).toEqual({ x: 15, y: 15 })
    expect(computeAbsolutePosition(grandchild, byId)).toEqual({ x: 17, y: 17 })
  })

  it('computeAbsolutePosition：缺失父级时停止累加', () => {
    const orphan = sized('o', 3, 3, 10, 10)
    orphan.parentId = 'missing'
    const byId = new Map([['o', orphan]])
    expect(computeAbsolutePosition(orphan, byId)).toEqual({ x: 3, y: 3 })
  })

  it('collectDescendantIds：收集嵌套全部后代', () => {
    const nodes: SuqNode[] = [
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'text', isGroup: true } },
      { id: 'a', type: 'text', position: { x: 0, y: 0 }, parentId: 'g', extent: 'parent', data: { kind: 'text' } },
      { id: 'b', type: 'text', position: { x: 0, y: 0 }, parentId: 'g', extent: 'parent', data: { kind: 'text' } },
      { id: 'sub', type: 'group', position: { x: 0, y: 0 }, parentId: 'g', extent: 'parent', data: { kind: 'text', isGroup: true } },
      { id: 'c', type: 'text', position: { x: 0, y: 0 }, parentId: 'sub', extent: 'parent', data: { kind: 'text' } },
    ]
    const ids = collectDescendantIds('g', nodes)
    expect(ids).toEqual(new Set(['a', 'b', 'sub', 'c']))
  })

  it('computeSelectionBoundingBox：绝对坐标包围盒', () => {
    const nodes = [sized('a', 0, 0, 100, 50), sized('b', 200, 100, 80, 80)]
    const box = computeSelectionBoundingBox(['a', 'b'], nodes)
    expect(box).toEqual({ x: 0, y: 0, w: 280, h: 180 })
  })

  it('reparentToGroup：position 转相对坐标并设置 parentId/extent', () => {
    const child = sized('c', 10, 20, 40, 40)
    const result = reparentToGroup([child], 'g', { x: 5, y: 5 })
    expect(result[0].parentId).toBe('g')
    expect(result[0].extent).toBe('parent')
    expect(result[0].position).toEqual({ x: 5, y: 15 })
  })

  it('reparentToGroup：被重挂节点位于其它父级内时仍按绝对坐标换算（嵌套成组不位移）', () => {
    // g1 绝对 (100,100)；c 相对 g1 为 (10,10) => c 绝对应为 (110,110)
    const g1 = sized('g1', 100, 100, 200, 200)
    g1.type = 'group'
    g1.data.isGroup = true
    const c = sized('c', 10, 10, 40, 40)
    c.parentId = 'g1'
    c.extent = 'parent'
    // 关键：被重挂的 c 拥有 selected 集合之外的祖先 g1，reparentToGroup 必须接收完整节点表
    // 才能沿祖先链算出 c 的绝对坐标（110,110），再转成相对 newG(110,110) 的 (0,0)。
    const fullNodes = [g1, c]
    const result = reparentToGroup([c], 'newG', { x: 110, y: 110 }, fullNodes)
    expect(result[0].parentId).toBe('newG')
    expect(result[0].position).toEqual({ x: 0, y: 0 })
  })

  it('dissolveGroup：直接子节点重指父级，绝对坐标保留', () => {
    const parent = sized('p', 100, 100, 300, 300)
    const group = sized('g', 10, 10, 200, 200)
    group.parentId = 'p'
    group.extent = 'parent'
    group.data.isGroup = true
    const child = sized('c', 20, 20, 40, 40)
    child.parentId = 'g'
    child.extent = 'parent'
    const nodes = [parent, group, child]
    const result = dissolveGroup(group, 'p', nodes)
    const c = result.find((n) => n.id === 'c')!
    // 子节点绝对坐标 = group(10,10)+parent(100,100)+child(20,20) = (130,130)
    // 重指到 p 后相对 p(100,100) => (30,30)
    expect(c.parentId).toBe('p')
    expect(c.extent).toBe('parent')
    expect(c.position).toEqual({ x: 30, y: 30 })
    // 分组节点仍在数组（移除由 Store 负责）
    expect(result.find((n) => n.id === 'g')).toBeDefined()
  })

  it('dissolveGroup：无父级时子节点归为顶层，坐标为绝对', () => {
    const group = sized('g', 50, 60, 200, 200)
    group.data.isGroup = true
    const child = sized('c', 10, 10, 40, 40)
    child.parentId = 'g'
    child.extent = 'parent'
    const nodes = [group, child]
    const result = dissolveGroup(group, undefined, nodes)
    const c = result.find((n) => n.id === 'c')!
    expect(c.parentId).toBeUndefined()
    expect(c.extent).toBeUndefined()
    expect(c.position).toEqual({ x: 60, y: 70 })
  })

  it('clampChildrenToParent：约束子节点在父框内', () => {
    const child = sized('c', 500, 500, 40, 40)
    child.parentId = 'g'
    child.extent = 'parent'
    const nodes = [child]
    const result = clampChildrenToParent('g', { w: 100, h: 100 }, nodes)
    const c = result.find((n) => n.id === 'c')!
    expect(c.position).toEqual({ x: 60, y: 60 })
  })

  it('clampChildrenToParent：无 extent 子节点不被约束', () => {
    const child = sized('c', 500, 500, 40, 40)
    child.parentId = 'g'
    const nodes = [child]
    const result = clampChildrenToParent('g', { w: 100, h: 100 }, nodes)
    expect(result.find((n) => n.id === 'c')!.position).toEqual({ x: 500, y: 500 })
  })

  it('normalizeGroupHierarchy：父节点先于子节点排序', () => {
    const child = leaf('c')
    child.parentId = 'g'
    child.extent = 'parent'
    const group = leaf('g')
    group.type = 'group'
    group.data.isGroup = true
    const top = leaf('t')
    const normalized = normalizeGroupHierarchy([child, group, top])
    const order = normalized.map((n) => n.id)
    expect(order.indexOf('g')).toBeLessThan(order.indexOf('c'))
    expect(order).toContain('t')
  })

  it('normalizeGroupHierarchy：孤儿节点降级为顶层', () => {
    const orphan = leaf('o')
    orphan.parentId = 'missing'
    orphan.extent = 'parent'
    const top = leaf('t')
    const normalized = normalizeGroupHierarchy([orphan, top])
    const o = normalized.find((n) => n.id === 'o')!
    expect(o.parentId).toBeUndefined()
    expect(o.extent).toBeUndefined()
  })

  it('normalizeGroupHierarchy：保持自环安全（不无限循环）', () => {
    const a = leaf('a')
    a.parentId = 'b'
    const b = leaf('b')
    b.parentId = 'a'
    const normalized = normalizeGroupHierarchy([a, b])
    expect(normalized).toHaveLength(2)
  })
})
