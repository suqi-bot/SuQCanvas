import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'

export const TextNode = memo(function TextNode(props: NodeProps<SuqNode>) {
  const { id, data } = props
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

  return (
    <MediaNodeShell node={props}>
      <div className="min-h-10 p-3">
        {editing ? (
          <textarea
            ref={textareaRef}
            defaultValue={data.text ?? ''}
            rows={Math.max(2, (data.text ?? '').split('\n').length + 2)}
            placeholder="输入文本…"
            className="nodrag w-full resize-none bg-transparent text-sm leading-relaxed text-main outline-none placeholder:text-dim"
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') commit(e.currentTarget.value)
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(e.currentTarget.value)
            }}
          />
        ) : (
          <div
            className="cursor-text whitespace-pre-wrap break-words text-sm leading-relaxed text-main"
            onDoubleClick={() => setEditing(true)}
          >
            {data.text && data.text.length > 0 ? data.text : <span className="text-dim">双击编辑文本</span>}
          </div>
        )}
      </div>
    </MediaNodeShell>
  )
})
