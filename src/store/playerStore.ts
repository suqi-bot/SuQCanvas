// 单一音乐播放引擎：全应用只有这一个播放器（画布音乐节点、悬浮窗、沉浸式播放器
// 都是它的视图/控制器），只有 GlobalPlayer 挂载的一个 <audio> 元素负责出声。
// 画布节点点击 = 调 play()；歌曲顺序统一由 playlists 模块(画布连线)解析。
import { create } from 'zustand'
import { getAssetUrl } from '../media/blobRegistry'
import { linearizeFrom } from '../media/playlists'
import { useCanvasStore } from './canvasStore'

export type PlaybackMode = 'sequential' | 'random' | 'loop' | 'single' | 'flow'

export interface EngineTrack {
  assetId: string
  name: string
  url: string
  /** 来源画布节点 id（用于沿连线解析流式顺序） */
  nodeId?: string
}

export interface PlaylistQueue {
  id: string
  name: string
  assetIds: string[]
}

interface PlayerState {
  track: EngineTrack | null
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  barVisible: boolean
  /** 播放模式（画布与播放器共用同一模式） */
  mode: PlaybackMode
  /** 当前歌单队列（仅流式模式存在；null = 按全部歌曲/画布连线顺序） */
  queue: PlaylistQueue | null
  /** 播放指定歌曲；opts.autoplay 控制是否立即起播（默认 false 只载入） */
  play: (t: { assetId: string; name?: string; nodeId?: string }, opts?: { autoplay?: boolean }) => void
  toggle: () => void
  seekTo: (time: number) => void
  seekBy: (delta: number) => void
  next: (opts?: { autoplay?: boolean; wrap?: boolean }) => void
  prev: () => void
  setVolume: (value: number) => void
  setMuted: (muted: boolean) => void
  setMode: (mode: PlaybackMode) => void
  setQueue: (queue: PlaylistQueue | null) => void
  stop: () => void
  setBarVisible: (visible: boolean) => void
}

let audioElement: HTMLAudioElement | null = null
/** 播放器未关闭时的排序列表提供者（顺序/随机/循环模式的导航基准）；关闭后置空 */
let orderProvider: (() => string[]) | null = null
/** 异步 URL 解析的竞态令牌：快速连续 play() 时只应用最后一次 */
let playSeq = 0

export function bindPlayerAudio(el: HTMLAudioElement | null): void {
  audioElement = el
}

/** 返回全局持久音频元素（GlobalPlayer 中注册），用于可视化等需要当前播放元素的地方 */
export function getPlayerAudioElement(): HTMLAudioElement | null {
  return audioElement
}

/** 注册/注销播放器视图的歌曲列表提供者（按 assetId 顺序） */
export function setOrderProvider(provider: (() => string[]) | null): void {
  orderProvider = provider
}

// 播放：数据未就绪时 play() 可能被拒绝，先直接尝试，失败后在 canplay 时重试
function requestPlay(el: HTMLAudioElement): void {
  const tryPlay = () => {
    void el.play().catch(() => {
      el.addEventListener(
        'canplay',
        () => void el.play().catch(() => undefined),
        { once: true },
      )
    })
  }
  if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) tryPlay()
  else {
    el.addEventListener('loadeddata', tryPlay, { once: true })
    tryPlay()
  }
}

/** 某首歌在画布上的音频节点 id（找不到时回退 undefined） */
function findNodeIdFor(assetId: string): string | undefined {
  return useCanvasStore
    .getState()
    .nodes.find((node) => node.data.kind === 'audio' && node.data.assetId === assetId)?.id
}

/** 沿画布连线解析某首歌的流式播放顺序 */
function graphOrderFor(assetId: string, nodeId?: string): string[] {
  const { nodes, edges } = useCanvasStore.getState()
  const startId = nodeId ?? findNodeIdFor(assetId)
  if (!startId) return [assetId]
  return linearizeFrom(nodes, edges, startId).assetIds
}

/** 当前导航基准顺序：歌单队列 → 播放器列表（打开时）→ 画布连线顺序 */
function baseOrder(): string[] | null {
  const s = usePlayerStore.getState()
  if (s.queue) return s.queue.assetIds
  const t = s.track
  if (!t) return null
  if (s.mode !== 'flow' && orderProvider) {
    const list = orderProvider()
    if (list && list.length > 0) return list
  }
  return graphOrderFor(t.assetId, t.nodeId)
}

function pickNextId(order: string[], currentId: string, wrap: boolean): string | undefined {
  const pos = order.indexOf(currentId)
  if (pos < 0) return order.length > 0 ? order[0] : undefined
  if (pos + 1 < order.length) return order[pos + 1]
  return wrap && order.length > 0 ? order[0] : undefined
}

function pickRandomId(order: string[], currentId: string): string | undefined {
  if (order.length < 2) return undefined
  let pick = currentId
  while (pick === currentId) pick = order[Math.floor(Math.random() * order.length)]
  return pick
}

/** 自然播完后的自动续播（由 GlobalPlayer 的 onEnded 触发） */
function handleEnded(): void {
  const s = usePlayerStore.getState()
  const el = audioElement
  const t = s.track
  if (!t) return
  if (s.mode === 'single') {
    // 单曲循环：从头重播
    if (el) {
      el.currentTime = 0
      requestPlay(el)
    }
    return
  }
  const order = baseOrder()
  let nextId: string | undefined
  if (s.mode === 'random') {
    nextId = order ? pickRandomId(order, t.assetId) : undefined
  } else {
    nextId = order ? pickNextId(order, t.assetId, s.mode === 'loop') : undefined
  }
  if (!nextId) return // 播完即停
  usePlayerStore
    .getState()
    .play({ assetId: nextId, nodeId: findNodeIdFor(nextId) }, { autoplay: true })
}

export function notifyEngineEnded(): void {
  handleEnded()
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  track: null,
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  barVisible: false,
  mode: 'sequential',
  queue: null,

  play: (t, opts) => {
    const el = audioElement
    const seq = ++playSeq
    const current = get().track
    // 同一首歌：不重新加载，仅保持/恢复播放状态
    if (current && current.assetId === t.assetId) {
      set({
        track: {
          ...current,
          name: t.name ?? current.name,
          nodeId: t.nodeId ?? current.nodeId,
        },
      })
      if (opts?.autoplay && el && el.paused) requestPlay(el)
      return
    }
    const name =
      t.name ??
      useCanvasStore
        .getState()
        .nodes.find((node) => node.data.kind === 'audio' && node.data.assetId === t.assetId)
        ?.data.label ??
      '音频'
    const apply = (url: string) => {
      if (seq !== playSeq) return
      set({ track: { assetId: t.assetId, name, url, nodeId: t.nodeId }, playing: false, time: 0, duration: 0 })
      if (el) {
        el.src = url
        el.load()
        if (opts?.autoplay) requestPlay(el)
      }
    }
    void getAssetUrl(t.assetId).then(apply).catch(() => {
      if (seq === playSeq) set({ track: null, playing: false, time: 0, duration: 0 })
    })
  },

  toggle: () => {
    const el = audioElement
    if (!el || !get().track) return
    if (el.paused) requestPlay(el)
    else el.pause()
  },

  seekTo: (time) => {
    const el = audioElement
    if (!el) {
      set({ time })
      return
    }
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : time
    el.currentTime = Math.max(0, Math.min(time, max))
    set({ time: el.currentTime })
  },

  seekBy: (delta) => {
    const el = audioElement
    if (!el || !get().track) return
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : el.currentTime + delta
    el.currentTime = Math.max(0, Math.min(el.currentTime + delta, max))
    set({ time: el.currentTime })
  },

  next: (opts) => {
    const s = get()
    if (!s.track) return
    const order = baseOrder()
    let nextId: string | undefined
    if (s.mode === 'random') {
      nextId = order ? pickRandomId(order, s.track.assetId) : undefined
    } else {
      nextId = order ? pickNextId(order, s.track.assetId, opts?.wrap ?? false) : undefined
    }
    if (!nextId) return
    playTrack(nextId, opts?.autoplay ?? true)
  },

  prev: () => {
    const s = get()
    if (!s.track) return
    const order = baseOrder()
    if (!order || order.length < 2) return
    const pos = order.indexOf(s.track.assetId)
    const prevId = pos > 0 ? order[pos - 1] : order[order.length - 1]
    playTrack(prevId, true)
  },

  setVolume: (value) => {
    set({ volume: value, muted: value === 0 })
  },

  setMuted: (muted) => {
    set({ muted })
  },

  setMode: (mode) => {
    // 离开流式模式即退出歌单队列（与播放器原行为一致）
    set({ mode, ...(mode !== 'flow' ? { queue: null } : {}) })
  },

  setQueue: (queue) => {
    set({ queue })
  },

  stop: () => {
    const el = audioElement
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    set({ track: null, playing: false, time: 0, duration: 0, queue: null, barVisible: false })
  },

  setBarVisible: (barVisible) => {
    set({ barVisible })
  },
}))

/** 切歌播放（供 next/prev 使用）：以画布节点作为来源，保证流式顺序可解析 */
function playTrack(assetId: string, autoplay: boolean): void {
  const nodeId = findNodeIdFor(assetId)
  usePlayerStore.getState().play({ assetId, nodeId }, { autoplay })
}
