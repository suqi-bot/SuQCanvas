import { memo, useEffect, useState, type ReactNode } from 'react'
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react'
import { useUiStore } from '../../store/uiStore'
import type { SuqNode } from '../../types'
import { KindIcon } from './Icons'
import { useLanStore } from '../../store/lanStore'

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
  const updateNodeInternals = useUpdateNodeInternals()
  const tool = useUiStore((s) => s.tool)
  const lock = useLanStore((s) =>
    Object.values(s.editing).find((item) => item.nodeId === id && item.userId !== s.selfId),
  )

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
      onPointerDownCapture={(event) => {
        if (!lock) return
        event.preventDefault()
        event.stopPropagation()
      }}
      aria-disabled={Boolean(lock)}
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

      {data.createdByName && (hovered || selected) && (
        <span
          className="pointer-events-none absolute bottom-1.5 right-1.5 max-w-[70%] truncate rounded bg-panel/90 px-1.5 py-0.5 text-[10px] text-dim shadow"
          title={`由 ${data.createdByName} 插入`}
        >
          {data.createdByName}
        </span>
      )}

      {lock && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/10">
          <span className="rounded bg-panel/90 px-2 py-1 text-xs text-soft shadow">
            {lock.name} 正在操作此元素
          </span>
        </div>
      )}
    </div>
  )
})
