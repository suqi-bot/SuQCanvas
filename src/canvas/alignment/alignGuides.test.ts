import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_SNAP_THRESHOLD_PX,
  type NodeBounds,
  getNodeBounds,
  computeAlignment,
} from './alignGuides'

/** 直接构造一组对齐参考线坐标（画布坐标系）。 */
function b(id: string, x: number, y: number, w: number, h: number): NodeBounds {
  return {
    id,
    left: x,
    centerX: x + w / 2,
    right: x + w,
    top: y,
    centerY: y + h / 2,
    bottom: y + h,
  }
}

/** 构造最小化的 React Flow 节点，供 getNodeBounds 使用。 */
function rfNode(id: string, x: number, y: number, w: number, h: number): Node {
  return {
    id,
    type: 'text',
    position: { x, y },
    data: {},
    measured: { width: w, height: h },
  } as Node
}

// 复用一组参考节点：other 位于 (100,100)，尺寸 200x100。
const OTHER = b('o', 100, 100, 200, 100) // left=100 cx=200 right=300 top=100 cy=150 bottom=200

describe('DEFAULT_SNAP_THRESHOLD_PX', () => {
  it('落在 5~8px 设计区间，且为 6', () => {
    expect(DEFAULT_SNAP_THRESHOLD_PX).toBe(6)
    expect(DEFAULT_SNAP_THRESHOLD_PX).toBeGreaterThanOrEqual(5)
    expect(DEFAULT_SNAP_THRESHOLD_PX).toBeLessThanOrEqual(8)
  })
})

describe('getNodeBounds', () => {
  it('使用 measured 尺寸计算六条参考线', () => {
    const nb = getNodeBounds(rfNode('a', 10, 20, 100, 50))
    expect(nb).toEqual({
      id: 'a',
      left: 10,
      centerX: 60,
      right: 110,
      top: 20,
      centerY: 45,
      bottom: 70,
    })
  })

  it('measured 缺失时回退到节点显式 width/height', () => {
    const node = {
      id: 'a',
      type: 'text',
      position: { x: 10, y: 20 },
      data: {},
      width: 80,
      height: 40,
    } as unknown as Node
    const nb = getNodeBounds(node)
    expect(nb.left).toBe(10)
    expect(nb.right).toBe(90)
    expect(nb.centerX).toBe(50)
    expect(nb.bottom).toBe(60)
  })

  it('尺寸完全缺失时回退到项目默认值 240x160', () => {
    const node = {
      id: 'a',
      type: 'text',
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as Node
    const nb = getNodeBounds(node)
    expect(nb.left).toBe(0)
    expect(nb.right).toBe(240)
    expect(nb.centerX).toBe(120)
    expect(nb.bottom).toBe(160)
  })

  it('measured 尺寸为 0 时回退到默认值（避免 0 宽高）', () => {
    const nb = getNodeBounds(rfNode('a', 5, 5, 0, 0))
    expect(nb.right).toBe(5 + 240)
    expect(nb.bottom).toBe(5 + 160)
  })
})

describe('computeAlignment', () => {
  it('完全对齐时偏移为 0 但仍产出参考线（实时对齐反馈）', () => {
    const dragged = b('d', 100, 100, 200, 100)
    const res = computeAlignment([dragged], [OTHER], 6)
    expect(res.deltaX).toBe(0)
    expect(res.deltaY).toBe(0)
    expect(res.guides).toHaveLength(2)
    expect(res.guides).toContainEqual({ orientation: 'vertical', position: 100, distance: 0 })
    expect(res.guides).toContainEqual({ orientation: 'horizontal', position: 100, distance: 0 })
  })

  it('差 3px（zoom=1, 阈值=6）内吸附：水平与垂直均吸附', () => {
    // dragged 左偏 3、上偏 4
    const dragged = b('d', 103, 104, 200, 100)
    const res = computeAlignment([dragged], [OTHER], 6)
    expect(res.deltaX).toBe(-3) // 左边缘对齐到 other 的左 100
    expect(res.deltaY).toBe(-4) // 上边缘对齐到 other 的上 100
    expect(res.guides).toHaveLength(2)
    const v = res.guides.find((g) => g.orientation === 'vertical')
    const h = res.guides.find((g) => g.orientation === 'horizontal')
    expect(v).toEqual({ orientation: 'vertical', position: 100, distance: 3 })
    expect(h).toEqual({ orientation: 'horizontal', position: 100, distance: 4 })
  })

  it('差 20px 超出阈值不吸附', () => {
    const dragged = b('d', 120, 120, 200, 100)
    const res = computeAlignment([dragged], [OTHER], 6)
    expect(res.deltaX).toBe(0)
    expect(res.deltaY).toBe(0)
    expect(res.guides).toHaveLength(0)
  })

  it('阈值随 zoom 换算（zoom=2 → 阈值=3 画布单位）：3 单位吸附、4 单位不吸附', () => {
    // 模拟 zoom=2 时 CanvasBoard 传入的阈值 = DEFAULT_SNAP_THRESHOLD_PX / 2 = 3
    const thresholdAtZoom2 = DEFAULT_SNAP_THRESHOLD_PX / 2
    expect(thresholdAtZoom2).toBe(3)

    // 3 个画布单位 = 6 屏幕像素，恰等于阈值 → 吸附
    const near = b('d', 103, 100, 200, 100)
    const r1 = computeAlignment([near], [OTHER], thresholdAtZoom2)
    expect(r1.deltaX).toBe(-3)
    expect(r1.guides.some((g) => g.orientation === 'vertical' && g.position === 100)).toBe(true)

    // 4 个画布单位 = 8 屏幕像素，超过阈值 → X、Y 均不吸附（注意 Y 也需错开，否则会恰好完美对齐）
    const far = b('d', 104, 104, 200, 100)
    const r2 = computeAlignment([far], [OTHER], thresholdAtZoom2)
    expect(r2.deltaX).toBe(0)
    expect(r2.deltaY).toBe(0)
    expect(r2.guides).toHaveLength(0)

    // 同样验证 Y 方向：Y 差 3 单位（=6 屏幕像素）吸附
    const nearY = b('d', 100, 103, 200, 100)
    const r3 = computeAlignment([nearY], [OTHER], thresholdAtZoom2)
    expect(r3.deltaY).toBe(-3)
    expect(
      r3.guides.some((g) => g.orientation === 'horizontal' && g.position === 100),
    ).toBe(true)
    // Y 差 4 单位（=8 屏幕像素）不吸附（X 恰好完美对齐，仅产生 vertical 参考线，无 horizontal）
    const farY = b('d', 100, 104, 200, 100)
    const r4 = computeAlignment([farY], [OTHER], thresholdAtZoom2)
    expect(r4.deltaY).toBe(0)
    expect(r4.guides.some((g) => g.orientation === 'horizontal')).toBe(false)
  })

  it('仅水平方向可吸附时只产出 vertical 参考线', () => {
    const dragged = b('d', 103, 130, 200, 100) // X 差 3（吸附），Y 差 20（不吸附）
    const res = computeAlignment([dragged], [OTHER], 6)
    expect(res.deltaX).toBe(-3)
    expect(res.deltaY).toBe(0)
    expect(res.guides).toHaveLength(1)
    expect(res.guides[0]).toEqual({ orientation: 'vertical', position: 100, distance: 3 })
  })

  it('仅垂直方向可吸附时只产出 horizontal 参考线', () => {
    const dragged = b('d', 150, 104, 200, 100) // X 差 50（不吸附），Y 差 4（吸附）
    const res = computeAlignment([dragged], [OTHER], 6)
    expect(res.deltaX).toBe(0)
    expect(res.deltaY).toBe(-4)
    expect(res.guides).toHaveLength(1)
    expect(res.guides[0]).toEqual({ orientation: 'horizontal', position: 100, distance: 4 })
  })

  it('空集合与非法阈值直接返回空结果', () => {
    const dragged = [b('d', 103, 104, 200, 100)]
    expect(computeAlignment([], [OTHER], 6)).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
    expect(computeAlignment(dragged, [], 6)).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
    expect(computeAlignment(dragged, [OTHER], 0)).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
    expect(computeAlignment(dragged, [OTHER], -1)).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })

  it('存在多个其它节点时选取间距最小的那个', () => {
    const others = [b('o1', 100, 100, 200, 100), b('o2', 500, 500, 200, 100)]
    const dragged = b('d', 103, 100, 200, 100) // 靠近 o1（3px），远离 o2
    const res = computeAlignment([dragged], others, 6)
    expect(res.deltaX).toBe(-3)
    expect(res.guides[0]).toEqual({ orientation: 'vertical', position: 100, distance: 3 })
  })

  it('与 getNodeBounds 组合（复刻 CanvasBoard 实际调用路径）', () => {
    const otherNode = rfNode('o', 100, 100, 200, 100)
    const draggedNode = rfNode('d', 103, 104, 200, 100)
    const res = computeAlignment(
      [getNodeBounds(draggedNode)],
      [getNodeBounds(otherNode)],
      6,
    )
    expect(res.deltaX).toBe(-3)
    expect(res.deltaY).toBe(-4)
    expect(res.guides).toHaveLength(2)
  })
})
