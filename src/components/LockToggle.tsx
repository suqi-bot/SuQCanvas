import { useCanvasStore } from '../store/canvasStore'

/** 锁定开关：调用 setNodeLocked 切换节点锁定状态（本期用于分组，默认 false）。 */
export function LockToggle({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const setNodeLocked = useCanvasStore((s) => s.setNodeLocked)
  return (
    <button
      type="button"
      onClick={() => setNodeLocked(nodeId, !locked)}
      className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
        locked
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
          : 'border-edge2 text-soft hover:bg-hover'
      }`}
    >
      {locked ? '已锁定（点击解锁）' : '未锁定（点击锁定）'}
    </button>
  )
}
