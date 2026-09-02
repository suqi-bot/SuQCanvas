/**
 * 对齐参考线渲染组件（功能 C）。
 *
 * 以「屏幕坐标覆盖层」方式渲染当前拖动中产生的参考线：
 * - vertical 参考线为贯穿画布的竖直虚线（高亮色），定位在对应参考线 x 的屏幕坐标；
 * - horizontal 参考线为贯穿画布的水平虚线，定位在对应参考线 y 的屏幕坐标；
 * - 坐标为 React Flow 的 flowToScreenPosition 转换结果，自动随视口平移/缩放保持一致；
 * - 组件订阅独立的 alignmentGuideStore，仅在该 store 变化时重渲染，不影响画布主体。
 *
 * 该组件应作为 <ReactFlow> 的子节点渲染，使其覆盖层相对于画布面板定位。
 */

import { useReactFlow } from '@xyflow/react'
import { useAlignmentGuideStore } from './alignmentGuideStore'

/** 参考线高亮颜色（在明暗主题下均具备足够对比度）。 */
const GUIDE_COLOR = '#22d3ee'

export function AlignmentGuides() {
  const guides = useAlignmentGuideStore((s) => s.guides)
  const { flowToScreenPosition } = useReactFlow()

  if (guides.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {guides.map((guide, index) => {
        if (guide.orientation === 'vertical') {
          const screen = flowToScreenPosition({ x: guide.position, y: 0 })
          return (
            <div
              key={`v-${index}`}
              className="absolute top-0 bottom-0"
              style={{
                left: screen.x,
                borderLeft: `2px dashed ${GUIDE_COLOR}`,
              }}
            />
          )
        }
        const screen = flowToScreenPosition({ x: 0, y: guide.position })
        return (
          <div
            key={`h-${index}`}
            className="absolute left-0 right-0"
            style={{
              top: screen.y,
              borderTop: `2px dashed ${GUIDE_COLOR}`,
            }}
          />
        )
      })}
    </div>
  )
}
