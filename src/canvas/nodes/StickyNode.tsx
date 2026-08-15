import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { STICKY_COLORS, type SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'
import { buildTextStyle, V_JUSTIFY } from './textStyle'

export const StickyNode = memo(function StickyNode(props: NodeProps<SuqNode>) {
  const { id, data } = props
  const color = STICKY_COLORS[data.color ?? 'yellow']
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

  const commit = (value: string) => {
    setEditing(false)
    updateNodeData(id, { text: value })
  }

  const textStyle = buildTextStyle(data)
  const vJustify = V_JUSTIFY[data.textAlignV ?? 'top']

  return (
    <MediaNodeShell node={props}>
      <div
        className="flex h-full w-full flex-col p-3"
        style={{ backgroundColor: color.bg, justifyContent: vJustify }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            defaultValue={data.text ?? ''}
            rows={Math.max(2, (data.text ?? '').split('\n').length + 2)}
            placeholder="输入便签内容…"
            style={textStyle}
            className="nodrag h-full w-full resize-none bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-500"
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
            className="h-full w-full cursor-text whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800"
            onDoubleClick={() => setEditing(true)}
          >
            {data.text && data.text.length > 0 ? (
              data.text
            ) : (
              <span className="text-slate-500">双击编辑便签</span>
            )}
          </div>
        )}
      </div>
    </MediaNodeShell>
  )
})
