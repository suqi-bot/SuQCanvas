import type { Edge, Node, Viewport } from '@xyflow/react'

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'text'
  | 'file'
  | 'heading'
  | 'sticky'
  | 'shape'

export type HeadingLevel = 1 | 2 | 3

/** level: 0 表示默认（无标题效果） */
export type HeadingLevelOrNone = 0 | HeadingLevel

export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type TextAlignV = 'top' | 'middle' | 'bottom'

export type ShapeType = 'rect' | 'ellipse'

export type StickyColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'gray'

export const STICKY_COLORS: Record<StickyColor, { bg: string; border: string }> = {
  yellow: { bg: '#fde68a', border: '#f59e0b' },
  green: { bg: '#bbf7d0', border: '#22c55e' },
  blue: { bg: '#bfdbfe', border: '#3b82f6' },
  pink: { bg: '#fbcfe8', border: '#ec4899' },
  purple: { bg: '#ddd6fe', border: '#8b5cf6' },
  gray: { bg: '#e2e8f0', border: '#94a3b8' },
}

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
  level?: HeadingLevelOrNone
  color?: StickyColor
  shape?: ShapeType
  fill?: string
  textAlign?: TextAlign
  textAlignV?: TextAlignV
  fontSize?: number
  fontFamily?: string
  textColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  lineHeight?: number
}

export interface SuqEdgeData extends Record<string, unknown> {
  style: EdgeStyle
}

export type SuqNode = Node<SuqNodeData> & { data: SuqNodeData }
export type SuqEdge = Edge<SuqEdgeData, 'styled'> & { data: SuqEdgeData }

export type AnyNode = Node & { data?: Record<string, unknown> }

export type CanvasViewport = Viewport
