import type { Edge, Node, Viewport } from '@xyflow/react'

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'text'
  | 'file'

export interface AssetMeta {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  hasThumbnail?: boolean
}

export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type PathType = 'bezier' | 'straight' | 'step' | 'smoothstep'
export type ArrowPos = 'none' | 'start' | 'end' | 'both'

export interface EdgeStyle {
  lineStyle: LineStyle
  pathType: PathType
  arrow: ArrowPos
  stroke: string
  strokeWidth: number
}

export const DEFAULT_EDGE_STYLE: EdgeStyle = {
  lineStyle: 'solid',
  pathType: 'bezier',
  arrow: 'end',
  stroke: '#94a3b8',
  strokeWidth: 2,
}

export interface SuqNodeData extends Record<string, unknown> {
  kind: MediaKind
  assetId?: string
  text?: string
  label?: string
  fileSize?: number
  mime?: string
  width?: number
  height?: number
  borderColor?: string
  backgroundColor?: string
  pageCount?: number
  autoEdit?: boolean
}

export interface SuqEdgeData extends Record<string, unknown> {
  style: EdgeStyle
}

export type SuqNode = Node<SuqNodeData> & { data: SuqNodeData }
export type SuqEdge = Edge<SuqEdgeData, 'styled'> & { data: SuqEdgeData }

export type AnyNode = Node & { data?: Record<string, unknown> }

export type CanvasViewport = Viewport
