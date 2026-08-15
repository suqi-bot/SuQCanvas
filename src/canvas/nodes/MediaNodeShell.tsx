import { memo, useState, type ReactNode } from 'react'
import { Handle, NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../../store/canvasStore'
import type { SuqNode } from '../../types'
import { CopyIcon, KindIcon, TrashIcon } from './Icons'

const HANDLE_SIDES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
] as const

interface ShellProps {
  node: NodeProps<SuqNode>
  children: ReactNode
}

export const MediaNodeShell = memo(function MediaNodeShell({ node, children }: ShellProps) {
  const { id, data, selected } = node
  const [hovered, setHovered] = useState(false)
  const { deleteElements } = useReactFlow()
  const duplicateNode = useCanvasStore((s) => s.duplicateNode)

  return (
    <div
      className={`media-shell group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-[var(--nodebg)] shadow-lg ${
        selected ? 'sq-selected' : ''
      }`}
      style={{ borderColor: data.borderColor ?? '#64748b' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {HANDLE_SIDES.map(({ id: hid, position }) => (
        <span key={hid}>
          <Handle
            id={`${hid}-target`}
            type="target"
            position={position}
            className="sq-handle sq-handle-target"
          />
          <Handle
            id={`${hid}-source`}
            type="source"
            position={position}
            className="sq-handle sq-handle-source"
          />
        </span>
      ))}

      <div className="min-h-0 flex-1">{children}</div>

      <div
        className="flex h-7 shrink-0 items-center gap-1.5 border-t bg-[var(--nodebar)] px-2"
        style={{ borderColor: 'var(--nodebarline)' }}
      >
        <span className="text-mid">
          <KindIcon kind={data.kind} />
        </span>
        <span className="truncate text-xs text-soft" title={data.label}>
          {data.label ?? ''}
        </span>
      </div>

      <NodeToolbar position={Position.Top} isVisible={hovered && !selected}>
        <div className="flex gap-1 rounded-lg border border-edge bg-panel p-1 shadow-xl">
          <button
            type="button"
            title="复制"
            className="rounded-md p-1.5 text-soft hover:bg-hover"
            onClick={() => duplicateNode(id)}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            title="删除"
            className="rounded-md p-1.5 text-rose-500 hover:bg-hover"
            onClick={() => deleteElements({ nodes: [{ id }] })}
          >
            <TrashIcon />
          </button>
        </div>
      </NodeToolbar>
    </div>
  )
})
