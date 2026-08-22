import { create } from 'zustand'

export interface PlayerTrack {
  assetId: string
  name: string
  url: string
}

export interface ExternalAudio {
  assetId: string
  name: string
  element: HTMLAudioElement
}

interface PlayerState {
  track: PlayerTrack | null
  external: ExternalAudio | null
  /** 当前由悬浮窗接管控制的来源：'track'（播放器）或 'external'（画布音频节点） */
  source: 'track' | 'external' | null
  trackPlaying: boolean
  trackTime: number
  trackDuration: number
  externalPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  barVisible: boolean
  setTrack: (track: PlayerTrack | null, opts?: { autoplay?: boolean }) => void
  setExternal: (external: ExternalAudio | null) => void
  toggle: () => void
  seekTo: (time: number) => void
  seekBy: (delta: number) => void
  setVolume: (value: number) => void
  setMuted: (muted: boolean) => void
  stop: () => void
  setBarVisible: (visible: boolean) => void
}

let audioElement: HTMLAudioElement | null = null
let endedHandler: (() => void) | null = null
let externalWired: { el: HTMLAudioElement; detach: () => void } | null = null

export function bindPlayerAudio(el: HTMLAudioElement | null): void {
  audioElement = el
}

/** 返回全局持久音频元素（GlobalPlayer 中注册），用于可视化等需要当前播放元素的地方 */
export function getPlayerAudioElement(): HTMLAudioElement | null {
  return audioElement
}

export function setPlayerEndedHandler(handler: (() => void) | null): void {
  endedHandler = handler
}

export function notifyPlayerEnded(): void {
  endedHandler?.()
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

// 先定位到指定时间、seek 就位后再(可选)起播。
// 直接 currentTime=... 后立刻 play(),在元素缓冲有旧数据时可能从旧进度起播,
// play 事件随之把旧时间写回 store,造成"进入播放器后进度回退"。
function seekToPosition(el: HTMLAudioElement, time: number, thenPlay: boolean): void {
  let done = false
  let timer = 0
  function finish(): void {
    if (done) return
    done = true
    el.removeEventListener('seeked', onSeeked)
    el.removeEventListener('canplay', onCanplay)
    window.clearTimeout(timer)
    if (thenPlay && el.paused) requestPlay(el)
  }
  function onSeeked(): void {
    finish()
  }
  function onCanplay(): void {
    // canplay 通常晚于 seeked;若 seek 已完成(或立即生效)则直接起播
    if (!el.seeking) finish()
  }
  function seek(): void {
    el.currentTime = time
    el.addEventListener('seeked', onSeeked)
    el.addEventListener('canplay', onCanplay)
    // 兜底:极端情况下 seeked/canplay 都未触发,1.5s 后强制起播
    timer = window.setTimeout(finish, 1500)
  }
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) seek()
  else el.addEventListener('loadedmetadata', seek, { once: true })
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  track: null,
  external: null,
  source: null,
  trackPlaying: false,
  trackTime: 0,
  trackDuration: 0,
  externalPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  barVisible: false,
  setTrack: (track, opts) => {
    const el = audioElement
    const state = get()
    const prev = state.track
    const external = state.external
    const sameTrack = track !== null && prev !== null && prev.assetId === track.assetId && prev.url === track.url
    // 同一首曲目由画布节点（external）接管时，接续节点当前进度（含暂停状态）并由全局播放器接管
    let carryTime: number | undefined
    let carryDuration: number | undefined
    let wasPlaying = false
    // 仅当节点正在播放时才从节点接续进度;节点已暂停时不得用其旧进度回退全局元素
    // (否则第二次进入播放器时会把正在播放的全局元素 seek 回第一次接管的暂停位置)
    const nodeActive = Boolean(
      track &&
        external &&
        external.assetId === track.assetId &&
        !external.element.paused,
    )
    if (nodeActive && track && external) {
      const extEl = external.element
      carryTime = extEl.currentTime
      wasPlaying = true
      if (Number.isFinite(extEl.duration) && extEl.duration > 0) {
        carryDuration = extEl.duration
      }
    }
    // 切换到与画布节点正在播放的不同曲目：先暂停节点，避免出现两个"正在播放"的来源
    if (track && external && external.assetId !== track.assetId) {
      external.element.pause()
    }
    if (sameTrack) {
      // 节点若已播放到与全局播放器不同的进度，把全局元素同步到节点进度，保证画布与播放器一致
      const wantsPlay = Boolean((opts?.autoplay || wasPlaying) && el && el.paused)
      const needsSeek = carryTime !== undefined && el && Math.abs((el.currentTime || 0) - carryTime) > 0.5
      if (wasPlaying) external?.element.pause()
      if (el) {
        if (needsSeek && carryTime !== undefined) {
          // 先等 seek 就位再起播，避免从全局元素缓冲的旧进度起播造成时间回退
          seekToPosition(el, carryTime, wantsPlay)
        } else if (wantsPlay) {
          requestPlay(el)
        }
      }
      set({ source: 'track', trackTime: carryTime ?? get().trackTime, currentTime: carryTime ?? get().currentTime })
      return
    }
    set({
      track,
      trackPlaying: wasPlaying,
      trackTime: carryTime ?? 0,
      trackDuration: carryDuration ?? 0,
      currentTime: carryTime ?? 0,
      duration: carryDuration ?? 0,
      source: track ? 'track' : external ? 'external' : null,
    })
    if (el) {
      if (track) {
        // 接管画布节点正在播放的同一曲目：先暂停节点音频，改由全局播放器继续播放
        if (wasPlaying) external?.element.pause()
        el.src = track.url
        el.load()
        const shouldPlay = wasPlaying || Boolean(opts?.autoplay)
        if (carryTime !== undefined) {
          // 等元数据就绪后定位并起播，保证接管进度与节点一致
          seekToPosition(el, carryTime, shouldPlay)
        } else if (shouldPlay) {
          requestPlay(el)
        }
      } else {
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
    }
  },
  setExternal: (external) => {
    const prev = get().external
    if (external && prev && prev.element === external.element) {
      set({ external: { ...prev, name: external.name }, source: 'external' })
      return
    }
    if (externalWired) {
      externalWired.detach()
      externalWired = null
    }
    if (external) {
      const el = external.element
      // 与全局共享音量/静音状态
      el.volume = get().volume
      el.muted = get().muted
      // loadedmetadata 可能在注册监听之前就已触发（preload=metadata），直接读取当前值补齐
      set({
        external,
        externalPlaying: !el.paused,
        currentTime: el.currentTime,
        duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0,
        source: 'external',
      })
      const onPlay = () => set({ externalPlaying: true, source: 'external', currentTime: el.currentTime })
      const onPause = () => set({ externalPlaying: false })
      const onTime = () => set({ currentTime: el.currentTime })
      const onDuration = () => set({ duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0 })
      el.addEventListener('play', onPlay)
      el.addEventListener('pause', onPause)
      el.addEventListener('timeupdate', onTime)
      el.addEventListener('loadedmetadata', onDuration)
      el.addEventListener('durationchange', onDuration)
      externalWired = {
        el,
        detach: () => {
          el.removeEventListener('play', onPlay)
          el.removeEventListener('pause', onPause)
          el.removeEventListener('timeupdate', onTime)
          el.removeEventListener('loadedmetadata', onDuration)
          el.removeEventListener('durationchange', onDuration)
        },
      }
    } else {
      set({ external: null, externalPlaying: false, source: get().track ? 'track' : null })
    }
  },
  toggle: () => {
    const state = get()
    // 与当前接管来源一致：外部节点接管且与播放器当前曲目相同时切换节点元素，否则切换全局播放器元素
    const externalEl =
      state.source === 'external' &&
      state.external &&
      state.track &&
      state.external.assetId === state.track.assetId
        ? state.external.element
        : null
    const el = externalEl ?? audioElement
    if (!el || (!externalEl && !state.track)) return
    if (el.paused) requestPlay(el)
    else el.pause()
  },
  seekTo: (time) => {
    const state = get()
    // 与当前接管来源一致：外部节点接管同一曲目时定位节点元素，否则定位全局播放器元素
    const externalEl =
      state.source === 'external' &&
      state.external &&
      state.external.assetId === state.track?.assetId
        ? state.external.element
        : null
    const el = externalEl ?? audioElement
    if (!el) {
      set({ trackTime: time, currentTime: time })
      return
    }
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : time
    el.currentTime = Math.max(0, Math.min(time, max))
    if (externalEl) set({ currentTime: el.currentTime })
    else set({ trackTime: el.currentTime, currentTime: el.currentTime })
  },
  seekBy: (delta) => {
    const el = audioElement
    if (!el || !get().track) return
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : el.currentTime + delta
    el.currentTime = Math.max(0, Math.min(el.currentTime + delta, max))
    set({ trackTime: el.currentTime, currentTime: el.currentTime })
  },
  setVolume: (value) => {
    set({ volume: value, muted: value === 0 })
  },
  setMuted: (muted) => {
    set({ muted })
  },
  stop: () => {
    const el = audioElement
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    const ext = get().external
    if (ext) ext.element.pause()
    if (externalWired) {
      externalWired.detach()
      externalWired = null
    }
    set({
      track: null,
      external: null,
      externalPlaying: false,
      source: null,
      trackPlaying: false,
      trackTime: 0,
      trackDuration: 0,
      currentTime: 0,
      duration: 0,
      barVisible: false,
    })
  },
  setBarVisible: (barVisible) => {
    set({ barVisible })
  },
}))

// 统一读取"当前播放"的派生状态：各界面一律通过这些 selector 取值，
// 避免自行按 source 拼装字段造成不同步
export const selectNowPlaying = (s: PlayerState): boolean =>
  s.source === 'external' ? s.externalPlaying : s.trackPlaying
export const selectNowTime = (s: PlayerState): number =>
  s.source === 'external' ? s.currentTime : s.trackTime
export const selectNowDuration = (s: PlayerState): number =>
  s.source === 'external' ? s.duration : s.trackDuration
