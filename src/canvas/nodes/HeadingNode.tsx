import { memo, useEffect, useRef, useState } from 'react'
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { HeadingLevelOrNone, SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'
import { buildTextStyle, V_JUSTIFY } from './textStyle'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'

const LEVEL_STYLE: Record<HeadingLevelOrNone, string> = {
  0: 'text-base font-normal',
  1: 'text-2xl font-bold',
  2: 'text-xl font-semibold',
  3: 'text-base font-medium',
}

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

export const HeadingNode = memo(function HeadingNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const level = (data.level ?? 1) as HeadingLevelOrNone
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const { screenToFlowPosition } = useReactFlow()
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  useEffect(() => {
    if (data.autoEdit) {
      setEditing(true)
      updateNodeData(id, { autoEdit: false })
    }
  }, [data.autoEdit, id, updateNodeData])

  useEffect(() => {
    if (editing) {
      const ta = textareaRef.current
      ta?.focus()
      ta?.select()
    }
  }, [editing])

  useEffect(() => {
    if (editing) setLanEditing(id, data.label ?? `标题 ${level}`)
    else clearLanEditing()
    return () => clearLanEditing()
  }, [editing, id, data.label, level])

  useEffect(() => {
    return () => {
      resizeRef.current = null
    }
  }, [])

  const commit = (value: string) => {
    setEditing(false)
    updateNodeData(id, { text: value })
  }

  const onResizePointerDown = (corner: Corner) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const node = useCanvasStore.getState().nodes.find((n) => n.id === id)
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
        { id, type: 'position', position: { x, y } },
        { id, type: 'dimensions', setAttributes: true, dimensions: { width: w, height: h } },
      ])
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const style = LEVEL_STYLE[level]
  const textStyle = buildTextStyle(data)
  const vJustify = V_JUSTIFY[data.textAlignV ?? 'top']

  const levelBar = (
    <div className="flex items-center gap-1 rounded-lg border border-edge bg-panel p-1 shadow-xl">
      {([0, 1, 2, 3] as HeadingLevelOrNone[]).map((lv) => (
        <button
          key={lv}
          type="button"
          onClick={() =>
            updateNodeData(id, { level: lv, label: lv === 0 ? '文本' : `标题 ${lv}` })
          }
          className={`nodrag rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
            level === lv ? 'bg-sky-600 text-white' : 'text-soft hover:bg-hover'
          }`}
        >
          {lv === 0 ? '默认' : `H${lv}`}
        </button>
      ))}
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-edge2" />
      <input
        type="range"
        min={8}
        max={72}
        value={data.fontSize ?? 14}
        onChange={(e) => updateNodeData(id, { fontSize: Number(e.target.value) })}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        title="文字大小"
        className="nodrag h-3 w-24 shrink-0 cursor-pointer accent-sky-500"
      />
    </div>
  )

  return (
    <MediaNodeShell node={props} showBar={editing}>
      <NodeToolbar position={Position.Top} isVisible={editing} offset={12}>
        {levelBar}
      </NodeToolbar>
      <div className="flex h-full min-h-12 flex-col p-3" style={{ justifyContent: vJustify }}>
        {editing ? (
          <textarea
            ref={textareaRef}
            defaultValue={data.text ?? ''}
            rows={Math.max(2, (data.text ?? '').split('\n').length + 2)}
            placeholder={`输入标题 ${level}…`}
            style={textStyle}
            className={`nodrag w-full resize-none bg-transparent ${style} leading-relaxed text-main outline-none placeholder:text-dim`}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') commit(e.currentTarget.value)
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(e.currentTarget.value)
            }}
          />
        ) : (
          <div
            style={textStyle}
            className={`cursor-text whitespace-pre-wrap break-words ${style} leading-relaxed text-main`}
            onDoubleClick={() => setEditing(true)}
          >
            {data.text && data.text.length > 0 ? (
              data.text
            ) : (
              <span className="font-normal text-dim">双击编辑标题</span>
            )}
          </div>
        )}
      </div>
      {selected && !editing && (
        <>
          {CORNERS.map((corner) => (
            <div
              key={corner}
              className={`nodrag absolute z-10 h-2.5 w-2.5 rounded-sm border border-white/80 bg-sky-500 shadow ${CORNER_POS[corner]}`}
              style={{ cursor: CORNER_CURSOR[corner] }}
              onPointerDown={onResizePointerDown(corner)}
            />
          ))}
        </>
      )}
    </MediaNodeShell>
  )
})
