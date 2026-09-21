import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'
import { buildTextStyle, V_JUSTIFY } from './textStyle'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'
import { useLanStore } from '../../store/lanStore'

export const ShapeNode = memo(function ShapeNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const shape = data.shape ?? 'rect'
  const locked = useLanStore((s) => Object.values(s.editing).some((item) => item.nodeId === id && item.userId !== s.selfId))
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
    if (editing) setLanEditing(id, data.label ?? '形状')
    else clearLanEditing()
    return () => clearLanEditing()
  }, [editing, id, data.label])

  const commit = (value: string) => {
    setEditing(false)
    updateNodeData(id, { text: value })
  }

  const textStyle = buildTextStyle(data)
  const vJustify = V_JUSTIFY[data.textAlignV ?? 'middle']

  return (
    <>
    <NodeResizer isVisible={selected && !editing && !locked} minWidth={48} minHeight={48}
      lineClassName="sq-image-resize-line" handleClassName="sq-image-resize-handle"
      onResizeStart={() => setLanEditing(id, data.label ?? '形状')} onResizeEnd={() => clearLanEditing()} />
    <MediaNodeShell node={props} geometry={shape} showBar={false}>
      <div
        className="relative h-full w-full"
        onDoubleClick={() => { if (!locked) setEditing(true) }}
      >
        <div
          className="absolute flex flex-col overflow-hidden p-2"
          style={{ inset: shape === 'ellipse' ? '14.645%' : 0, justifyContent: vJustify }}
        >
          {editing ? (
            <textarea
              ref={textareaRef}
              defaultValue={data.text ?? ''}
              rows={Math.max(1, (data.text ?? '').split('\n').length)}
              placeholder="输入文字…"
              style={textStyle}
              className="nodrag w-full resize-none bg-transparent text-center text-sm leading-relaxed text-main outline-none placeholder:text-dim"
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
              className="w-full cursor-text whitespace-pre-wrap break-words text-sm leading-relaxed text-main"
            >
              {data.text && data.text.length > 0 ? data.text : null}
            </div>
          )}
        </div>
      </div>
    </MediaNodeShell>
    </>
  )
})
