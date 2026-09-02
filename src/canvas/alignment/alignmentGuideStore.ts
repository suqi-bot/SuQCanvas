/**
 * 对齐参考线（功能 C）的瞬时状态 store。
 *
 * 该 store 仅用于在「拖动过程中」保存当前需要渲染的参考线数据，属于瞬态状态：
 * - 不持久化（拖动结束即清空）；
 * - 与画布主 store / 设置 store 解耦，避免拖动每帧更新导致 ReactFlow 整体重渲染；
 *  只有订阅该 store 的 <AlignmentGuides /> 组件会在参考线变化时重渲染。
 */

import { create } from 'zustand'
import type { GuideLine } from './alignGuides'

interface AlignmentGuideState {
  /** 当前需要渲染的参考线（通常为 0~2 条）。 */
  guides: GuideLine[]
  /** 设置参考线数据（拖动中每帧调用）。 */
  setGuides: (guides: GuideLine[]) => void
  /** 清空参考线（拖动开始/结束、或关闭吸附时调用）。 */
  clear: () => void
}

export const useAlignmentGuideStore = create<AlignmentGuideState>((set) => ({
  guides: [],
  setGuides: (guides) => set({ guides }),
  clear: () => set({ guides: [] }),
}))
