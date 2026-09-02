import { memo, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { onLockChange } from '../../sync/lanClient'
import { ResizeHandles } from './ResizeHandles'
import { LockIcon } from './Icons'

/**
 * 分组容器节点渲染：半透明背景框 + 顶部标题栏（分组命名/锁标）+ 选中时四角缩放手柄。
 * - 整体移动/连线端点跟随：由 React Flow 原生 parentId+extent 处理（拖动父节点带动子孙）。
 * - 缩放约束子节点：ResizeHandles 写入 dimensions 后，由 canvasStore.onNodesChange 调用
 *   clampChildrenToParent 保证子节点不溢出（无等比缩放）。
 * - 锁定：data.locked（或局域网远端锁定）时不可拖动、隐藏缩放手柄并显示锁标。
 */
export const GroupNode = memo(function GroupNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  // 订阅局域网锁定广播，远端锁定后立即显示锁标（主数据同步到达前提供即时反馈）
  const [remoteLocked, setRemoteLocked] = useState(false)

  useEffect(() => {
    return onLockChange((nodeId, locked) => {
      if (nodeId === id) setRemoteLocked(locked)
    })
  }, [id])

  const locked = Boolean(data.locked) || remoteLocked
  const bg = data.groupColor ? `${data.groupColor}22` : 'rgba(148, 163, 184, 0.10)'
  const border = data.groupColor ?? (locked ? '#f59e0b' : 'rgba(148, 163, 184, 0.5)')

  return (
    <div className="group relative h-full w-full">
      <div
        className="h-full w-full rounded-2xl border-2 border-dashed"
        style={{ backgroundColor: bg, borderColor: border }}
      >
        <div className="flex items-center gap-1 px-2 py-1">
          {locked && (
            <span className="text-amber-500" title="已锁定">
              <LockIcon />
            </span>
          )}
          <span
            className="truncate text-xs font-medium text-soft"
            title={data.groupName ?? '分组'}
          >
            {data.groupName ?? '分组'}
          </span>
        </div>
      </div>
      {selected && !locked && <ResizeHandles nodeId={id} />}
    </div>
  )
})
