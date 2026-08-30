import { memo, useEffect, useRef, useState } from 'react'
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import type { HeadingLevelOrNone, SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'
import { buildTextStyle, V_JUSTIFY } from './textStyle'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'
import { ResizeHandles } from './ResizeHandles'

const LEVEL_STYLE: Record<HeadingLevelOrNone, string> = {
  0: 'text-base font-normal',
  1: 'text-2xl font-bold',
  2: 'text-xl font-semibold',
  3: 'text-base font-medium',
}

export const HeadingNode = memo(function HeadingNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const level = (data.level ?? 1) as HeadingLevelOrNone
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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

  const commit = (value: string) => {
    setEditing(false)
    updateNodeData(id, { text: value })
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
      {selected && !editing && <ResizeHandles nodeId={id} />}
    </MediaNodeShell>
  )
})
