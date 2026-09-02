import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'
import { computeSelectionBoundingBox } from '../canvas/groups'

/**
 * 浮动「组合」按钮：当选区（≥2 个非分组节点）且处于选择工具时，
 * 显示在选框顶部中央，点击调用 groupSelected() 成组。
 *
 * 必须作为 <ReactFlow> 子节点渲染：其定位使用 flowToScreenPosition（相对画布面板），
 * 与 AlignmentGuides 覆盖层共用同一坐标系。
 */
export function GroupToolbar() {
  const { flowToScreenPosition } = useReactFlow()
  const nodes = useCanvasStore((s) => s.nodes)
  const groupSelected = useCanvasStore((s) => s.groupSelected)
  const tool = useUiStore((s) => s.tool)

  const selected = nodes.filter((n) => n.selected && !n.data.isGroup)
  if (tool !== 'select' || selected.length < 2) return null

  const box = computeSelectionBoundingBox(
    selected.map((n) => n.id),
    nodes,
  )
  const screen = flowToScreenPosition({ x: box.x + box.w / 2, y: box.y })

  return (
    <button
      type="button"
      onClick={() => groupSelected()}
      className="absolute z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-edge2 bg-panel/95 px-3 py-1.5 text-xs font-medium text-main shadow-lg hover:bg-hover"
      style={{ left: screen.x, top: Math.max(8, screen.y - 44) }}
    >
      组合（{selected.length}）
    </button>
  )
}
