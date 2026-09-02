import type { SuqNode } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { LockToggle } from './LockToggle'
import { TrashIcon } from '../canvas/nodes/Icons'
import { Section } from './InspectorPanel'

/**
 * 分组专属 Inspector 面板区块（P0：命名 + 锁定 + 解散）。
 * 尺寸只读展示（由画布上拖拽分组边框调整），连线在解散时原样保留。
 */
export function GroupInspectorSection({ node }: { node: SuqNode }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const dissolveGroup = useCanvasStore((s) => s.dissolveGroup)

  const w = typeof node.width === 'number' ? node.width : node.style?.width ?? 0
  const h = typeof node.height === 'number' ? node.height : node.style?.height ?? 0

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-medium">分组</span>
        <button
          type="button"
          onClick={() => dissolveGroup(node.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-hover"
        >
          <TrashIcon /> 解散分组
        </button>
      </div>
      <Section title="分组名称">
        <input
          value={node.data.groupName ?? ''}
          onChange={(e) => updateNodeData(node.id, { groupName: e.target.value })}
          placeholder="未命名分组"
          className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-sky-500"
        />
      </Section>
      <Section title="尺寸">
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[10px] text-dim">宽 (px)</span>
            <input
              type="number"
              value={Math.round(Number(w))}
              disabled
              readOnly
              className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs tabular-nums text-main outline-none"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-[10px] text-dim">高 (px)</span>
            <input
              type="number"
              value={Math.round(Number(h))}
              disabled
              readOnly
              className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs tabular-nums text-main outline-none"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-dim">尺寸由画布上拖拽分组边框调整</p>
      </Section>
      <Section title="锁定">
        <LockToggle nodeId={node.id} locked={Boolean(node.data.locked)} />
        <p className="mt-1.5 text-[10px] leading-relaxed text-dim">锁定后分组不可拖动或缩放</p>
      </Section>
    </>
  )
}
