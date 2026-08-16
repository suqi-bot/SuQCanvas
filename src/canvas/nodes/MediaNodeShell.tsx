import { memo, useEffect, useState, type ReactNode } from 'react'
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore } from '../../store/uiStore'
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
  showBar?: boolean
}

export const MediaNodeShell = memo(function MediaNodeShell({
  node,
  children,
  showBar = true,
}: ShellProps) {
  const { id, data, selected } = node
  const [hovered, setHovered] = useState(false)
  const { deleteElements } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const duplicateNode = useCanvasStore((s) => s.duplicateNode)
  const tool = useUiStore((s) => s.tool)

  // 模式切换时让 ReactFlow 重新测量手柄边界，保证连线模式下的边条带热区生效
  useEffect(() => {
    updateNodeInternals(id)
  }, [tool, id, updateNodeInternals])

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

      {/* 连线模式：四条边作为连接热区，支持点击/拖动从对应边引线 */}
      {HANDLE_SIDES.map(({ id: sid, position }) => (
        <span key={`strip-${sid}`}>
          <Handle
            id={`connect-${sid}`}
            type="source"
            position={position}
            isConnectable={tool === 'connect'}
            isConnectableEnd={false}
            className="sq-handle sq-handle-strip sq-handle-source"
          />
          <Handle
            id={`connect-${sid}`}
            type="target"
            position={position}
            isConnectable={tool === 'connect'}
            isConnectableStart={false}
            className="sq-handle sq-handle-strip sq-handle-target"
          />
        </span>
      ))}

      <div className="min-h-0 flex-1">{children}</div>

      {showBar && selected && (
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
      )}

      <NodeToolbar position={Position.Top} isVisible={hovered && !selected && tool !== 'connect'}>
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
