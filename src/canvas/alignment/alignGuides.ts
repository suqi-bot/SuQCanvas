/**
 * 对齐参考线（功能 C）核心计算模块。
 *
 * 该模块提供：
 * - `getNodeBounds`：根据节点的 position 与 measured 尺寸计算其六条对齐参考线坐标；
 * - `computeAlignment`：在拖动过程中，对「被拖节点集合」与「其它节点集合」做边缘/中心
 *   智能吸附对齐，返回需施加到被拖节点的统一偏移量（deltaX/deltaY）以及需要渲染的参考线。
 *
 * 计算完全在「画布坐标（flow coordinates）」空间进行，与视口缩放无关；阈值由调用方按
 * 屏幕像素 / zoom 转换后传入。模块保持纯函数、无副作用，便于复用与测试。
 */

import type { Node } from '@xyflow/react'

/** 屏幕像素阈值：被拖节点与其它节点的间距小于该值（按屏幕像素计）时触发吸附。 */
export const DEFAULT_SNAP_THRESHOLD_PX = 6

/** 参考线方向：vertical 为贯穿画布的垂直辅助线（对应 x 坐标），horizontal 为水平辅助线（对应 y 坐标）。 */
export type Orientation = 'vertical' | 'horizontal'

/** 单个节点的对齐参考线坐标（画布坐标系）。 */
export interface NodeBounds {
  id: string
  /** 左边缘 x */
  left: number
  /** 水平中心 x */
  centerX: number
  /** 右边缘 x */
  right: number
  /** 上边缘 y */
  top: number
  /** 垂直中心 y */
  centerY: number
  /** 下边缘 y */
  bottom: number
}

/** 一条需要渲染的高亮参考线。 */
export interface GuideLine {
  orientation: Orientation
  /**
   * 画布坐标：
   * - orientation 为 'vertical' 时表示辅助线的 x 坐标；
   * - orientation 为 'horizontal' 时表示辅助线的 y 坐标。
   */
  position: number
  /** 触发吸附时的间距（画布坐标），用于可选的间距数值展示。 */
  distance: number
}

/** 一次对齐计算的结果。 */
export interface AlignmentResult {
  /** 需统一施加到所有被拖节点的 x 偏移（画布坐标）。 */
  deltaX: number
  /** 需统一施加到所有被拖节点的 y 偏移（画布坐标）。 */
  deltaY: number
  /** 需要渲染的参考线集合。 */
  guides: GuideLine[]
}

const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 160

/**
 * 根据节点计算其六条对齐参考线坐标。
 * 尺寸优先使用已测量的 measured.width/height，回退到节点显式 width/height，
 * 最后回退到项目默认值（与 canvasStore.alignSelected 中保持一致）。
 *
 * @param node 任意 React Flow 节点（需含 position 与尺寸信息）
 * @returns 该节点的对齐参考线坐标
 */
export function getNodeBounds(node: Node): NodeBounds {
  const width =
    node.measured?.width ?? (typeof node.width === 'number' ? node.width : DEFAULT_WIDTH)
  const height =
    node.measured?.height ?? (typeof node.height === 'number' ? node.height : DEFAULT_HEIGHT)
  const w = width || DEFAULT_WIDTH
  const h = height || DEFAULT_HEIGHT
  const { x, y } = node.position
  return {
    id: node.id,
    left: x,
    centerX: x + w / 2,
    right: x + w,
    top: y,
    centerY: y + h / 2,
    bottom: y + h,
  }
}

/**
 * 计算被拖节点集合与画布上其它节点集合之间的吸附对齐。
 *
 * 算法：
 * 1. 收集其它节点的三条垂直参考线（left/centerX/right）与三条水平参考线（top/centerY/bottom）；
 * 2. 对每个被拖节点的三条垂直/水平参考线，寻找与「其它节点参考线」最小间距且低于阈值者；
 * 3. 取 x、y 两个方向上各自全局最小间距的吸附关系，得到统一偏移 deltaX/deltaY；
 * 4. 偏移施加到整个被拖集合（保持相对位置），并在被吸附到的其它节点参考线处生成参考线。
 *
 * X 与 Y 方向独立计算，因此一次拖动可同时水平对齐 A 节点、垂直对齐 B 节点。
 *
 * @param dragged  当前被拖动的节点集合边界（已含本次拖动的实时位置）
 * @param others   画布上其余不参与拖动的节点边界
 * @param threshold 吸附阈值（画布坐标 = 屏幕像素阈值 / zoom）
 * @returns 偏移量与参考线数据
 */
export function computeAlignment(
  dragged: NodeBounds[],
  others: NodeBounds[],
  threshold: number,
): AlignmentResult {
  const guides: GuideLine[] = []
  let deltaX = 0
  let deltaY = 0

  if (dragged.length === 0 || others.length === 0 || threshold <= 0) {
    return { deltaX, deltaY, guides }
  }

  // 其它节点的候选垂直/水平参考线坐标。
  const otherX: number[] = []
  const otherY: number[] = []
  for (const o of others) {
    otherX.push(o.left, o.centerX, o.right)
    otherY.push(o.top, o.centerY, o.bottom)
  }

  // X 方向：遍历所有被拖节点 × 其三条垂直参考线 × 其它节点参考线，取最小间距。
  let bestX: { delta: number; pos: number; dist: number } | null = null
  for (const d of dragged) {
    const candidateX = [d.left, d.centerX, d.right]
    for (const dx of candidateX) {
      for (const ox of otherX) {
        const diff = ox - dx
        const dist = Math.abs(diff)
        if (dist <= threshold && (bestX === null || dist < bestX.dist)) {
          bestX = { delta: diff, pos: ox, dist }
        }
      }
    }
  }
  if (bestX) {
    deltaX = bestX.delta
    guides.push({ orientation: 'vertical', position: bestX.pos, distance: bestX.dist })
  }

  // Y 方向：同理。
  let bestY: { delta: number; pos: number; dist: number } | null = null
  for (const d of dragged) {
    const candidateY = [d.top, d.centerY, d.bottom]
    for (const dy of candidateY) {
      for (const oy of otherY) {
        const diff = oy - dy
        const dist = Math.abs(diff)
        if (dist <= threshold && (bestY === null || dist < bestY.dist)) {
          bestY = { delta: diff, pos: oy, dist }
        }
      }
    }
  }
  if (bestY) {
    deltaY = bestY.delta
    guides.push({ orientation: 'horizontal', position: bestY.pos, distance: bestY.dist })
  }

  return { deltaX, deltaY, guides }
}
