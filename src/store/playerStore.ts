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
    // 同一首曲目正由画布节点（external）播放时，接续进度并由全局播放器接管
    let carryTime: number | undefined
    let wasPlaying = false
    if (track && external && external.assetId === track.assetId && !external.element.paused) {
      carryTime = external.element.currentTime
      wasPlaying = true
    }
    if (sameTrack) {
      if ((opts?.autoplay || wasPlaying) && el && el.paused) requestPlay(el)
      if (wasPlaying) external?.element.pause()
      set({ source: 'track' })
      return
    }
    set({
      track,
      trackPlaying: wasPlaying,
      trackTime: carryTime ?? 0,
      trackDuration: 0,
      currentTime: carryTime ?? 0,
      duration: 0,
      source: track ? 'track' : external ? 'external' : null,
    })
    if (el) {
      if (track) {
        el.src = track.url
        el.load()
        if (carryTime !== undefined) el.currentTime = carryTime
        if (wasPlaying) {
          // 接管画布节点正在播放的同一曲目：暂停节点音频，改由全局播放器继续播放
          external?.element.pause()
          requestPlay(el)
        } else if (opts?.autoplay) {
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
      const onPlay = () => set({ externalPlaying: true })
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
    const el = audioElement
    if (!el || !get().track) return
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  },
  seekTo: (time) => {
    const el = audioElement
    if (el && Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = Math.max(0, Math.min(time, el.duration))
    }
    set({ trackTime: el ? el.currentTime : time, currentTime: el ? el.currentTime : time })
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
