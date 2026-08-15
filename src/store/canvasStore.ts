import type { Connection, EdgeChange, NodeChange, Viewport } from '@xyflow/react'
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { create } from 'zustand'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'

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
  alignSelected: (mode: AlignMode) => void
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],

  onNodesChange: (changes) => {
    const s = get()
    if (changes.some((c) => c.type === 'remove')) {
      flushPending(get)
      snapshotNow(set, get)
    } else {
      scheduleSnapshot(get)
    }
    set({ nodes: applyNodeChanges(changes, s.nodes) })
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
    set({ nodes: [...get().nodes, ...nodes] })
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
    }
    snapshotNow(set, get)
    set({ nodes: [...get().nodes, clone] })
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
    set({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  },
}))
