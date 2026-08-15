import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'

let idCounter = 0
export function genId(prefix = 'n'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

interface CanvasState {
  nodes: SuqNode[]
  edges: SuqEdge[]
  viewport: Viewport
  onNodesChange: (changes: NodeChange<SuqNode>[]) => void
  onEdgesChange: (changes: EdgeChange<SuqEdge>[]) => void
  onConnect: (connection: Connection) => void
  addNodes: (nodes: SuqNode[]) => void
  addEdge: (edge: SuqEdge) => void
  updateNodeData: (id: string, data: Partial<SuqNode['data']>) => void
  updateNodeStyle: (id: string, style: CSSProperties) => void
  updateEdgeData: (id: string, data: Partial<SuqEdge['data']>) => void
  duplicateNode: (id: string) => void
  setViewport: (viewport: Viewport) => void
  reset: () => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) })
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
    set({ edges: [...get().edges, edge] })
  },
  addNodes: (nodes) => {
    set({ nodes: [...get().nodes, ...nodes] })
  },
  addEdge: (edge) => {
    set({ edges: [...get().edges, edge] })
  },
  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })
  },
  updateNodeStyle: (id, style) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, style: { ...n.style, ...style } } : n,
      ),
    })
  },
  updateEdgeData: (id, data) => {
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
    set({ nodes: [...get().nodes, clone] })
  },
  setViewport: (viewport) => {
    set({ viewport })
  },
  reset: () => {
    set({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
  },
}))
