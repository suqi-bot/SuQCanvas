import { useCallback, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../../store/canvasStore'

const MIN_W = 120
const MIN_H = 40

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
type Corner = (typeof CORNERS)[number]

const CORNER_CURSOR: Record<Corner, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
}

const CORNER_POS: Record<Corner, string> = {
  nw: 'left-0 top-0',
  ne: 'right-0 top-0',
  sw: 'left-0 bottom-0',
  se: 'right-0 bottom-0',
}

interface ResizeState {
  corner: Corner
  x: number
  y: number
  w: number
  h: number
  fx: number
  fy: number
}

export function ResizeHandles({ nodeId }: { nodeId: string }) {
  const { screenToFlowPosition } = useReactFlow()
  const resizeRef = useRef<ResizeState | null>(null)

  useEffect(() => {
    return () => {
      resizeRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (corner: Corner) => (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return
      const base = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      resizeRef.current = {
        corner,
        x: node.position.x,
        y: node.position.y,
        w: (node.width as number | undefined) ?? (node.style?.width as number | undefined) ?? 200,
        h: (node.height as number | undefined) ?? (node.style?.height as number | undefined) ?? 60,
        fx: base.x,
        fy: base.y,
      }
      const onMove = (ev: PointerEvent) => {
        const r = resizeRef.current
        if (!r) return
        const cur = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        const dx = cur.x - r.fx
        const dy = cur.y - r.fy
        let x = r.x
        let y = r.y
        let w = r.w
        let h = r.h
        if (r.corner.includes('w')) {
          w = r.w - dx
          x = r.x + dx
        }
        if (r.corner.includes('e')) w = r.w + dx
        if (r.corner.includes('n')) {
          h = r.h - dy
          y = r.y + dy
        }
        if (r.corner.includes('s')) h = r.h + dy
        if (w < MIN_W) {
          if (r.corner.includes('w')) x = r.x + (r.w - MIN_W)
          w = MIN_W
        }
        if (h < MIN_H) {
          if (r.corner.includes('n')) y = r.y + (r.h - MIN_H)
          h = MIN_H
        }
        useCanvasStore.getState().onNodesChange([
          { id: nodeId, type: 'position', position: { x, y } },
          { id: nodeId, type: 'dimensions', setAttributes: true, dimensions: { width: w, height: h } },
        ])
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId, screenToFlowPosition],
  )

  return (
    <>
      {CORNERS.map((corner) => (
        <div
          key={corner}
          className={`nodrag absolute z-10 h-2.5 w-2.5 rounded-sm border border-white/80 bg-sky-500 shadow ${CORNER_POS[corner]}`}
          style={{ cursor: CORNER_CURSOR[corner] }}
          onPointerDown={onPointerDown(corner)}
        />
      ))}
    </>
  )
}
