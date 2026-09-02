import type {
  Connection,
  EdgeChange,
  NodeChange,
  NodeDimensionChange,
  Viewport,
  XYPosition,
} from '@xyflow/react'
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { create } from 'zustand'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'
import {
  clampChildrenToParent,
  collectDescendantIds,
  computeAbsolutePosition,
  computeSelectionBoundingBox,
  dissolveGroup as dissolveGroupNodes,
  reparentToGroup,
} from '../canvas/groups'
import { useLanStore } from './lanStore'
import { broadcastLock } from '../sync/lanClient'

let idCounter = 0
export function genId(prefix = 'n'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

export type AlignMode =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom'
  | 'distributeH'
  | 'distributeV'

export type LayerMode = 'front' | 'forward' | 'backward' | 'back'

interface HistoryEntry {
  nodes: SuqNode[]
  edges: SuqEdge[]
}

const HISTORY_LIMIT = 50
const HISTORY_DEBOUNCE = 400

interface CanvasState {
  nodes: SuqNode[]
  edges: SuqEdge[]
  viewport: Viewport
  past: HistoryEntry[]
  future: HistoryEntry[]
  onNodesChange: (changes: NodeChange<SuqNode>[]) => void
  onEdgesChange: (changes: EdgeChange<SuqEdge>[]) => void
  onConnect: (connection: Connection) => void
  addNodes: (nodes: SuqNode[]) => void
  addEdge: (edge: SuqEdge) => void
  updateNodeData: (id: string, data: Partial<SuqNode['data']>) => void
  updateEdgeData: (id: string, data: Partial<SuqEdge['data']>) => void
  duplicateNode: (id: string) => void
  clipboard: SuqNode[] | null
  copySelected: () => void
  pasteClipboard: () => void
  changeNodeLayer: (id: string, mode: LayerMode) => void
  setNodeZIndex: (id: string, zIndex: number) => void
  removeAssets: (assetIds: string[]) => void
  alignSelected: (mode: AlignMode) => void
  /** 把当前多选（非分组）节点成组为一个 group 节点 */
  groupSelected: () => void
  /** 解散指定分组（成员归位到原父级/顶层，连线保留） */
  dissolveGroup: (groupId: string) => void
  /** 连同子孙一起删除分组（并删除相关连线） */
  deleteGroupWithDescendants: (groupId: string) => void
  /** 返回节点在画布中的绝对坐标 */
  getAbsolutePosition: (id: string) => XYPosition
  /** 锁定/解锁节点（本期用于分组，默认 false），并广播局域网 */
  setNodeLocked: (id: string, locked: boolean) => void
  undo: () => void
  redo: () => void
  clearHistory: () => void
  setViewport: (viewport: Viewport) => void
  reset: () => void
}

let pendingSnapshot: HistoryEntry | null = null
let historyTimer: ReturnType<typeof setTimeout> | null = null

type SetFn = (partial: Partial<CanvasState>) => void

function pushHistory(entry: HistoryEntry, past: HistoryEntry[]): HistoryEntry[] {
  const last = past[past.length - 1]
  if (last && last.nodes === entry.nodes && last.edges === entry.edges) return past
  return [...past, entry].slice(-HISTORY_LIMIT)
}

function snapshotNow(set: SetFn, get: () => CanvasState) {
  set({ past: pushHistory({ nodes: get().nodes, edges: get().edges }, get().past), future: [] })
}

function scheduleSnapshot(get: () => CanvasState) {
  if (!pendingSnapshot) {
    pendingSnapshot = { nodes: get().nodes, edges: get().edges }
  }
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    historyTimer = null
    const snap = pendingSnapshot
    pendingSnapshot = null
    if (!snap) return
    const { past } = get()
    const next = pushHistory(snap, past)
    if (next.length !== past.length) {
      useCanvasStore.setState({ past: next, future: [] })
    }
  }, HISTORY_DEBOUNCE)
}

function flushPending(get: () => CanvasState) {
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
  const snap = pendingSnapshot
  pendingSnapshot = null
  if (!snap) return
  const { past } = get()
  const next = pushHistory(snap, past)
  if (next.length !== past.length) {
    useCanvasStore.setState({ past: next, future: [] })
  }
}

function insertionMeta() {
  const lan = useLanStore.getState()
  return {
    createdById: lan.selfId || undefined,
    createdByName: lan.name.trim() || '本机用户',
    createdAt: Date.now(),
  }
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],
  clipboard: null,

  onNodesChange: (changes) => {
    const s = get()
    let expanded = changes
    // 分组节点被删除时，连带移除其全部子孙（避免孤儿节点渲染异常）
    const removes = changes.filter((c) => c.type === 'remove')
    if (removes.length > 0) {
      const groupIds = removes
        .map((c) => c.id)
        .filter((id) => s.nodes.find((n) => n.id === id && n.data.isGroup))
      if (groupIds.length > 0) {
        const removed = new Set(groupIds)
        for (const gid of groupIds) {
          for (const d of collectDescendantIds(gid, s.nodes)) removed.add(d)
        }
        const already = new Set(removes.map((c) => c.id))
        const extra = [...removed]
          .filter((id) => !already.has(id))
          .map((id) => ({ id, type: 'remove' as const }))
        if (extra.length > 0) expanded = [...changes, ...extra]
      }
    }
    // 分组缩放（用户拖拽手柄 setAttributes）后，将 extent:'parent' 子节点约束在父框内，避免溢出
    const groupDimChanges = expanded.filter(
      (c): c is NodeDimensionChange =>
        c.type === 'dimensions' &&
        c.setAttributes === true &&
        c.dimensions != null &&
        s.nodes.some((n) => n.id === c.id && n.data.isGroup),
    )
    let nodes = applyNodeChanges(expanded, s.nodes)
    for (const gc of groupDimChanges) {
      const dims = gc.dimensions
      if (!dims) continue
      nodes = clampChildrenToParent(gc.id, { w: dims.width, h: dims.height }, nodes)
    }
    let edges = s.edges
    const removedAny = expanded.some((c) => c.type === 'remove')
    // 移除分组子孙时同步清理相关连线（连线随节点删除而清理）
    if (removedAny) {
      const removedIds = new Set(expanded.filter((c) => c.type === 'remove').map((c) => c.id))
      edges = edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
    }
    if (removedAny) {
      flushPending(get)
      snapshotNow(set, get)
    } else {
      scheduleSnapshot(get)
    }
    set({ nodes, edges })
  },
  onEdgesChange: (changes) => {
    const s = get()
    if (changes.some((c) => c.type === 'remove')) {
      flushPending(get)
      snapshotNow(set, get)
    } else {
      scheduleSnapshot(get)
    }
    set({ edges: applyEdgeChanges(changes, s.edges) })
  },
  onConnect: (connection) => {
    const edge: SuqEdge = {
      id: genId('e'),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'styled',
      data: { style: { ...DEFAULT_EDGE_STYLE } },
    }
    snapshotNow(set, get)
    set({ edges: [...get().edges, edge] })
  },
  addNodes: (nodes) => {
    snapshotNow(set, get)
    const meta = insertionMeta()
    set({
      nodes: [
        ...get().nodes,
        ...nodes.map((node) => ({
          ...node,
          data: node.data.createdByName ? node.data : { ...node.data, ...meta },
        })),
      ],
    })
  },
  addEdge: (edge) => {
    snapshotNow(set, get)
    set({ edges: [...get().edges, edge] })
  },
  updateNodeData: (id, data) => {
    snapshotNow(set, get)
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })
  },
  updateEdgeData: (id, data) => {
    snapshotNow(set, get)
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data, ...data } } : e,
      ),
    })
  },
duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const clone: SuqNode = {
      ...node,
      id: genId('n'),
      position: { x: node.position.x + 28, y: node.position.y + 28 },
      selected: false,
      data: { ...node.data, ...insertionMeta() },
    }
    snapshotNow(set, get)
    set({ nodes: [...get().nodes, clone] })
  },
  copySelected: () => {
    const nodes = get().nodes.filter((n) => n.selected)
    if (nodes.length === 0) return
    set({
      clipboard: structuredClone(
        nodes.map((n) => ({ ...n, selected: false, dragging: false } as SuqNode)),
      ),
    })
  },
  pasteClipboard: () => {
    const clipboard = get().clipboard
    if (!clipboard || clipboard.length === 0) return
    snapshotNow(set, get)
    const idMap = new Map(clipboard.map((n) => [n.id, genId('n')]))
    const pasted: SuqNode[] = clipboard.map((node) => {
      const clone = structuredClone(node) as SuqNode
      clone.id = idMap.get(node.id)!
      clone.position = { x: node.position.x + 28, y: node.position.y + 28 }
      clone.selected = true
      clone.dragging = false
      clone.data = { ...clone.data, ...insertionMeta() }
      return clone
    })
    const selected = new Set(pasted.map((n) => n.id))
    const pasteEdges: SuqEdge[] = get()
      .edges.filter(
        (e) => idMap.has(e.source) && idMap.has(e.target),
      )
      .map((e) => ({
        ...structuredClone(e),
        id: genId('e'),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }))
    set({
      nodes: [
        ...get().nodes.map((n) => ({ ...n, selected: selected.has(n.id) })),
        ...pasted,
      ],
      edges: [...get().edges, ...pasteEdges],
    })
  },
  changeNodeLayer: (id, mode) => {
    const nodes = get().nodes
    const ordered = [...nodes].sort(
      (a, b) => (a.zIndex ?? nodes.indexOf(a)) - (b.zIndex ?? nodes.indexOf(b)),
    )
    const index = ordered.findIndex((node) => node.id === id)
    if (index < 0) return
    let target = index
    if (mode === 'front') target = ordered.length - 1
    else if (mode === 'forward') target = Math.min(ordered.length - 1, index + 1)
    else if (mode === 'backward') target = Math.max(0, index - 1)
    else target = 0
    if (target === index) return
    const [node] = ordered.splice(index, 1)
    ordered.splice(target, 0, node)
    const ranks = new Map(ordered.map((item, rank) => [item.id, rank]))
    snapshotNow(set, get)
    set({ nodes: nodes.map((item) => ({ ...item, zIndex: ranks.get(item.id) ?? 0 })) })
  },
  setNodeZIndex: (id, value) => {
    if (!Number.isFinite(value)) return
    const zIndex = Math.min(9999, Math.max(0, Math.trunc(value)))
    const nodes = get().nodes
    const node = nodes.find((item) => item.id === id)
    if (!node || node.zIndex === zIndex) return
    snapshotNow(set, get)
    set({ nodes: nodes.map((item) => (item.id === id ? { ...item, zIndex } : item)) })
  },
  removeAssets: (assetIds) => {
    const ids = new Set(assetIds)
    if (ids.size === 0) return
    const removedNodeIds = new Set(
      get().nodes.filter((node) => node.data.assetId && ids.has(node.data.assetId)).map((node) => node.id),
    )
    if (removedNodeIds.size === 0) return
    snapshotNow(set, get)
    set({
      nodes: get().nodes.filter((node) => !removedNodeIds.has(node.id)),
      edges: get().edges.filter(
        (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
      ),
    })
  },
  alignSelected: (mode) => {
    const nodes = get().nodes
    const sel = nodes.filter((n) => n.selected)
    if (sel.length < 2) return
    const sizeOf = (n: SuqNode) => ({
      w:
        (typeof n.width === 'number' ? n.width : 0) ||
        (typeof n.style?.width === 'number' ? n.style.width : 0) ||
        (n.measured?.width ?? 0) ||
        240,
      h:
        (typeof n.height === 'number' ? n.height : 0) ||
        (typeof n.style?.height === 'number' ? n.style.height : 0) ||
        (n.measured?.height ?? 0) ||
        160,
    })
    const updated = new Map<string, { x: number; y: number }>()
    if (mode === 'distributeH' || mode === 'distributeV') {
      const axis = mode === 'distributeH' ? 'x' : 'y'
      const size = mode === 'distributeH' ? 'w' : 'h'
      const sorted = [...sel].sort((a, b) => a.position[axis] - b.position[axis])
      let min = Infinity
      let max = -Infinity
      let total = 0
      for (const n of sorted) {
        const p = n.position[axis]
        const s = sizeOf(n)[size]
        min = Math.min(min, p)
        max = Math.max(max, p + s)
        total += s
      }
      if (sorted.length <= 2) return
      const gap = (max - min - total) / (sorted.length - 1)
      let cursor = min
      for (const n of sorted) {
        const s = sizeOf(n)[size]
        const prev = updated.get(n.id) ?? { x: 0, y: 0 }
        updated.set(n.id, axis === 'x' ? { x: cursor, y: prev.y } : { x: prev.x, y: cursor })
        cursor += s + gap
      }
    } else {
      const bounds = sel.reduce(
        (acc, n) => {
          const s = sizeOf(n)
          acc.minX = Math.min(acc.minX, n.position.x)
          acc.minY = Math.min(acc.minY, n.position.y)
          acc.maxX = Math.max(acc.maxX, n.position.x + s.w)
          acc.maxY = Math.max(acc.maxY, n.position.y + s.h)
          return acc
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      for (const n of sel) {
        const s = sizeOf(n)
        const pos = { x: n.position.x, y: n.position.y }
        if (mode === 'left') pos.x = bounds.minX
        else if (mode === 'centerH') pos.x = bounds.minX + (bounds.maxX - bounds.minX - s.w) / 2
        else if (mode === 'right') pos.x = bounds.maxX - s.w
        else if (mode === 'top') pos.y = bounds.minY
        else if (mode === 'centerV') pos.y = bounds.minY + (bounds.maxY - bounds.minY - s.h) / 2
        else if (mode === 'bottom') pos.y = bounds.maxY - s.h
        updated.set(n.id, pos)
      }
    }
    snapshotNow(set, get)
    set({
      nodes: nodes.map((n) => {
        const pos = updated.get(n.id)
        return pos ? { ...n, position: pos } : n
      }),
    })
  },
  undo: () => {
    const { past, future, nodes, edges } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future].slice(0, HISTORY_LIMIT),
      nodes: prev.nodes,
      edges: prev.edges,
    })
  },
  redo: () => {
    const { past, future, nodes, edges } = get()
    const next = future[0]
    if (!next) return
    set({
      future: future.slice(1),
      past: pushHistory({ nodes, edges }, past),
      nodes: next.nodes,
      edges: next.edges,
    })
  },
  clearHistory: () => {
    pendingSnapshot = null
    if (historyTimer) {
      clearTimeout(historyTimer)
      historyTimer = null
    }
    set({ past: [], future: [] })
  },
  setViewport: (viewport) => {
    set({ viewport })
  },
  reset: () => {
    set({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, clipboard: null })
  },
  groupSelected: () => {
    const nodes = get().nodes
    const selected = nodes.filter((n) => n.selected && !n.data.isGroup)
    if (selected.length < 2) return
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const box = computeSelectionBoundingBox(
      selected.map((n) => n.id),
      nodes,
    )
    // 选中节点若同属一个父级，则新分组也嵌套在该父级下；否则为顶层分组
    const parentIds = new Set(selected.map((n) => n.parentId))
    const commonParent = parentIds.size === 1 ? [...parentIds][0] : undefined
    const groupId = genId('group')
    const parentAbs = commonParent ? computeAbsolutePosition(byId.get(commonParent)!, byId) : null
    const groupNode: SuqNode = {
      id: groupId,
      type: 'group',
      position:
        commonParent && parentAbs
          ? { x: box.x - parentAbs.x, y: box.y - parentAbs.y }
          : { x: box.x, y: box.y },
      ...(commonParent ? { parentId: commonParent, extent: 'parent' as const } : {}),
      style: { width: Math.max(1, box.w), height: Math.max(1, box.h) },
      zIndex: 0,
      // kind 对分组节点无意义，仅为满足 SuqNodeData 必填约束；GroupNode 由 type 驱动渲染
      data: { kind: 'text', isGroup: true, groupName: '分组', label: '分组' },
      selected: true,
    }
    const groupAbsPos: XYPosition = commonParent && parentAbs ? parentAbs : { x: box.x, y: box.y }
    // 传入完整 nodes 作为 allNodes：被重挂节点若存在祖先（嵌套分组），
    // computeAbsolutePosition 需沿祖先链算出其真实绝对坐标，避免嵌套成组位移错位
    const reparented = reparentToGroup(selected, groupId, groupAbsPos, nodes)
    const selectedIds = new Set(selected.map((n) => n.id))
    snapshotNow(set, get)
    // 用重挂后的子节点替换原选中节点（避免重复），再追加分组节点
    set({ nodes: [...nodes.filter((n) => !selectedIds.has(n.id)), groupNode, ...reparented] })
  },
  dissolveGroup: (groupId) => {
    const nodes = get().nodes
    const group = nodes.find((n) => n.id === groupId)
    if (!group || !group.data.isGroup) return
    const reparented = dissolveGroupNodes(group, group.parentId, nodes)
    snapshotNow(set, get)
    // 移除分组节点本身；直接子节点已重指父级，更深层后代保持不变，连线不动
    set({ nodes: reparented.filter((n) => n.id !== groupId) })
  },
  deleteGroupWithDescendants: (groupId) => {
    const nodes = get().nodes
    const group = nodes.find((n) => n.id === groupId)
    if (!group) return
    const removeIds = new Set<string>([groupId, ...collectDescendantIds(groupId, nodes)])
    const allEdges = get().edges
    snapshotNow(set, get)
    set({
      nodes: nodes.filter((n) => !removeIds.has(n.id)),
      edges: allEdges.filter(
        (e) => !removeIds.has(e.source) && !removeIds.has(e.target),
      ),
    })
  },
  getAbsolutePosition: (id) => {
    const nodes = get().nodes
    const node = nodes.find((n) => n.id === id)
    if (!node) return { x: 0, y: 0 }
    return computeAbsolutePosition(node, new Map(nodes.map((n) => [n.id, n])))
  },
  setNodeLocked: (id, locked) => {
    const exists = get().nodes.some((n) => n.id === id)
    if (!exists) return
    snapshotNow(set, get)
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, locked }, draggable: !locked } : n,
      ),
    })
    // 广播锁定状态给局域网协作者（离线/未连接时无副作用）
    try {
      broadcastLock(id, locked)
    } catch {
      // 忽略广播异常
    }
  },
}))
