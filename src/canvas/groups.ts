import type { XYPosition } from '@xyflow/react'
import type { SuqNode } from '../types'

/** 轴对齐包围盒（绝对画布坐标） */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 单个节点的渲染尺寸（优先 measured，回退 style，最后默认值） */
function nodeSize(node: SuqNode): { w: number; h: number } {
  const w =
    typeof node.width === 'number'
      ? node.width
      : typeof node.measured?.width === 'number'
        ? node.measured.width
        : typeof node.style?.width === 'number'
          ? node.style.width
          : 240
  const h =
    typeof node.height === 'number'
      ? node.height
      : typeof node.measured?.height === 'number'
        ? node.measured.height
        : typeof node.style?.height === 'number'
          ? node.style.height
          : 160
  return { w, h }
}

/**
 * 计算节点在画布中的绝对坐标（沿祖先链累加 parent.position + child.position）。
 * 顶层节点的 position 即为绝对坐标；有 parentId 的节点 position 为相对父坐标。
 */
export function computeAbsolutePosition(node: SuqNode, byId: Map<string, SuqNode>): XYPosition {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentId
  let guard = 0
  while (parentId && guard < 1000) {
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
    guard += 1
  }
  return { x, y }
}

/** 收集某分组的所有后代 id（含嵌套子分组及其成员），返回扁平集合 */
export function collectDescendantIds(groupId: string, nodes: SuqNode[]): Set<string> {
  const result = new Set<string>()
  const directChildren = nodes.filter((n) => n.parentId === groupId)
  for (const child of directChildren) {
    result.add(child.id)
    for (const descendant of collectDescendantIds(child.id, nodes)) {
      result.add(descendant)
    }
  }
  return result
}

/** 仅返回直接子节点 id（一层） */
export function getDirectChildIds(parentId: string, nodes: SuqNode[]): string[] {
  return nodes.filter((n) => n.parentId === parentId).map((n) => n.id)
}

/** 选中节点在绝对坐标下的包围盒 */
export function computeSelectionBoundingBox(ids: string[], nodes: SuqNode[]): Box {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const selected = ids
    .map((id) => byId.get(id))
    .filter((n): n is SuqNode => Boolean(n))
  if (selected.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of selected) {
    const abs = computeAbsolutePosition(n, byId)
    const { w, h } = nodeSize(n)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + w)
    maxY = Math.max(maxY, abs.y + h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * 把若干节点重挂到新分组下：position 转为相对 groupAbsPos 的坐标，
 * 并设置 parentId 与 extent:'parent'（约束在父框内）。
 *
 * @param allNodes 完整节点表（含被重挂节点的祖先）。computeAbsolutePosition 沿祖先链累加
 *   绝对坐标，必须能查到祖先；缺省回退到 children（适用于被重挂节点均为顶层节点的情形）。
 */
export function reparentToGroup(
  children: SuqNode[],
  groupId: string,
  groupAbsPos: XYPosition,
  allNodes?: SuqNode[],
): SuqNode[] {
  const byId = new Map((allNodes ?? children).map((n) => [n.id, n]))
  return children.map((child) => {
    const abs = computeAbsolutePosition(child, byId)
    return {
      ...child,
      parentId: groupId,
      extent: 'parent' as const,
      position: { x: abs.x - groupAbsPos.x, y: abs.y - groupAbsPos.y },
    }
  })
}

/**
 * 解散分组：把直接子节点重指到 newParentId（undefined 表示顶层），
 * 绝对坐标保留（相对新父重新换算）。更深层后代的 parentId/相对坐标不变，
 * 整体位置随上层重指自然保留。返回完整节点数组（不含对分组节点本身的删除）。
 */
export function dissolveGroup(
  group: SuqNode,
  newParentId: string | undefined,
  nodes: SuqNode[],
): SuqNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const newParent = newParentId ? byId.get(newParentId) : undefined
  const newParentAbs = newParent ? computeAbsolutePosition(newParent, byId) : { x: 0, y: 0 }
  const updated = new Map<string, SuqNode>()
  for (const child of nodes.filter((n) => n.parentId === group.id)) {
    const childAbs = computeAbsolutePosition(child, byId)
    updated.set(child.id, {
      ...child,
      parentId: newParentId,
      extent: newParentId ? ('parent' as const) : undefined,
      position: {
        x: childAbs.x - newParentAbs.x,
        y: childAbs.y - newParentAbs.y,
      },
    })
  }
  return nodes.map((n) => updated.get(n.id) ?? n)
}

/**
 * 分组缩放后，把 extent:'parent' 的直接子节点位置 clamp 到父框 [0,w]x[0,h] 内，
 * 防止父框缩小后子节点溢出（React Flow 的 extent 仅在“拖拽子节点”时约束，不约束“父缩放”）。
 */
export function clampChildrenToParent(
  groupId: string,
  size: { w: number; h: number },
  nodes: SuqNode[],
): SuqNode[] {
  const direct = nodes.filter((n) => n.parentId === groupId && n.extent === 'parent')
  if (direct.length === 0) return nodes
  const clamped = new Map<string, SuqNode>()
  for (const child of direct) {
    const { w, h } = nodeSize(child)
    const x = Math.min(Math.max(child.position.x, 0), Math.max(0, size.w - w))
    const y = Math.min(Math.max(child.position.y, 0), Math.max(0, size.h - h))
    clamped.set(child.id, { ...child, position: { x, y } })
  }
  return nodes.map((n) => clamped.get(n.id) ?? n)
}

/** 祖先链深度（用于导入排序：父先于子） */
function ancestorDepth(node: SuqNode, byId: Map<string, SuqNode>): number {
  let depth = 0
  let parentId = node.parentId
  let guard = 0
  const visited = new Set<string>()
  while (parentId && guard < 1000) {
    if (visited.has(parentId)) break // 防御环
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    depth += 1
    parentId = parent.parentId
    guard += 1
  }
  return depth
}

/**
 * 导入归一化：父节点先于子节点排序（React Flow 要求父在数组中先出现），
 * 并把 parentId 指向不存在节点的“孤儿”降级为顶层（坐标视为绝对），避免渲染异常。
 */
export function normalizeGroupHierarchy(nodes: SuqNode[]): SuqNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // 孤儿降级：parentId 指向不存在的节点 → 顶层，移除 parentId/extent
  const cleaned = nodes.map((n) => {
    if (n.parentId && !byId.has(n.parentId)) {
      const { parentId: _p, extent: _e, ...rest } = n
      return rest as SuqNode
    }
    return n
  })
  const cleanedById = new Map(cleaned.map((n) => [n.id, n]))
  const withDepth = cleaned.map((n) => ({ node: n, depth: ancestorDepth(n, cleanedById) }))
  withDepth.sort((a, b) => a.depth - b.depth)
  return withDepth.map((d) => d.node)
}
