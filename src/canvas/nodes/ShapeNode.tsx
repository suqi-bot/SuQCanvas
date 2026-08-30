import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'
import { buildTextStyle, V_JUSTIFY } from './textStyle'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'
import { ResizeHandles } from './ResizeHandles'

export const ShapeNode = memo(function ShapeNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const shape = data.shape ?? 'rect'
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
    <MediaNodeShell node={props}>
      <div
        className={`h-full w-full ${shape === 'rect' ? 'rounded-lg' : 'rounded-full'}`}
        style={{ backgroundColor: data.fill ?? '#38bdf8' }}
        onDoubleClick={() => setEditing(true)}
      >
        <div
          className="flex h-full w-full flex-col p-2"
          style={{ justifyContent: vJustify }}
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
      {selected && !editing && <ResizeHandles nodeId={id} />}
    </MediaNodeShell>
  )
})
