import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from '../canvas/nodes/Icons'
import { registerAudio } from '../media/mediaCoordinator'
import { closePip, isPipSupported, openPip } from '../media/pipWindow'
import { findPlaylistByAsset, resolvePlaylistsCached } from '../media/playlists'
import { bindPlayerAudio, notifyEngineEnded, usePlayerStore } from '../store/playerStore'
import { useNeteaseStore } from '../store/neteaseStore'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'

function fmtTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

// 常驻本地音频元素 + 本地 MP3 / 网易云共用的悬浮迷你控制栏。
export function GlobalPlayer() {
  const track = usePlayerStore((s) => s.track)
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.time)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const barVisible = usePlayerStore((s) => s.barVisible)
  const neteaseOpen = useNeteaseStore((s) => s.open)
  const neteaseSongId = useNeteaseStore((s) => s.activeSongId)
  const neteaseSongName = useNeteaseStore((s) => s.activeSongName)
  const neteaseQueue = useNeteaseStore((s) => s.playQueue)
  const neteaseQueueSource = useNeteaseStore((s) => s.queueSource)
  const neteasePlaying = useNeteaseStore((s) => s.externalPlaying)
  const neteaseTime = useNeteaseStore((s) => s.externalTime)
  const neteaseDuration = useNeteaseStore((s) => s.externalDuration)
  const neteaseFloatingVisible = useNeteaseStore((s) => s.floatingVisible)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const scrubTimeRef = useRef<number | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, input')) return
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: dragPos?.x ?? rect.left,
      originY: dragPos?.y ?? rect.top,
    }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const bar = barRef.current
    const maxX = Math.max(0, window.innerWidth - (bar?.offsetWidth ?? 240))
    const maxY = Math.max(0, window.innerHeight - (bar?.offsetHeight ?? 48))
    setDragPos({
      x: Math.max(0, Math.min(drag.originX + (e.clientX - drag.startX), maxX)),
      y: Math.max(0, Math.min(drag.originY + (e.clientY - drag.startY), maxY)),
    })
  }
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // 展开/收起或窗口尺寸变化后，把拖拽位置重新钳制在视口内，
  // 避免“收起状态下拖到边缘、再展开”时悬浮条超出屏幕边界
  useEffect(() => {
    const clamp = () => {
      const bar = barRef.current
      if (!bar) return
      setDragPos((prev) => {
        if (!prev) return prev
        const maxX = Math.max(0, window.innerWidth - bar.offsetWidth)
        const maxY = Math.max(0, window.innerHeight - bar.offsetHeight)
        const x = Math.max(0, Math.min(prev.x, maxX))
        const y = Math.max(0, Math.min(prev.y, maxY))
        if (x === prev.x && y === prev.y) return prev
        return { x, y }
      })
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [collapsed])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    bindPlayerAudio(el)
    el.volume = usePlayerStore.getState().volume
    el.muted = usePlayerStore.getState().muted
    const unregister = registerAudio(el)
    return () => {
      unregister()
      bindPlayerAudio(null)
    }
  }, [])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = volume
    el.muted = muted
  }, [volume, muted])

  useEffect(() => {
    const store = usePlayerStore
    ;(window as any).__pipCtrl = {
      getState: () => store.getState(),
      toggle: () => store.getState().toggle(),
      next: () => store.getState().next({ wrap: true }),
      prev: () => store.getState().prev(),
      seekRatio: (r: number) => {
        const s = store.getState()
        if (s.duration > 0) store.getState().seekTo(r * s.duration)
      },
    }
    return () => { delete (window as any).__pipCtrl }
  }, [])

  useEffect(() => {
    if (!track) closePip()
  }, [track])

  useEffect(() => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = null
    scrubTimeRef.current = null
    setScrubTime(null)
  }, [neteaseSongId, track?.assetId])

  useEffect(() => () => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
  }, [])

  const usingNetease = track === null && neteaseOpen && Boolean(neteaseSongId) && neteaseFloatingVisible
  const shown = (barVisible && track !== null) || usingNetease
  const name = usingNetease ? neteaseSongName : (track?.name ?? '')
  const shownPlaying = usingNetease ? neteasePlaying : playing
  const shownTime = usingNetease ? neteaseTime : currentTime
  const shownDuration = usingNetease ? neteaseDuration : duration
  const neteaseQueueIndex = neteaseQueue.findIndex((song) => song.id === neteaseSongId)
  const disableNeteasePrevious = neteaseQueue.length < 2 || (neteaseQueueSource === 'flow' && neteaseQueueIndex <= 0)
  const disableNeteaseNext = neteaseQueue.length < 2 || (neteaseQueueSource === 'flow' && neteaseQueueIndex >= neteaseQueue.length - 1)
  const seekTime = scrubTime ?? shownTime
  const progress = shownDuration > 0 ? Math.min(100, Math.max(0, seekTime / shownDuration * 100)) : 0

  // 当前播放的歌曲所属的画布歌单名(多个歌单包含同一首歌时取第一个)
  const canvasNodes = useCanvasStore((s) => s.nodes)
  const canvasEdges = useCanvasStore((s) => s.edges)
  const playlists = useMemo(
    () => resolvePlaylistsCached(canvasNodes, canvasEdges),
    [canvasNodes, canvasEdges],
  )
  const activeAssetId = track?.assetId
  const playlistName = useMemo(
    () => findPlaylistByAsset(playlists, activeAssetId)?.name,
    [playlists, activeAssetId],
  )
  const onOpenPlayer = () => {
    const player = usePlayerStore.getState()
    if (player.track?.assetId) {
      // 来自画布节点（带 nodeId）的曲目按流式模式打开，连播顺序沿用画布连线
      useUiStore.getState().openMusicPlayer(player.track.assetId, Boolean(player.track.nodeId))
    }
  }
  const onToggle = () => {
    if (usingNetease && neteaseSongId) void useNeteaseStore.getState().toggleSong(neteaseSongId)
    else usePlayerStore.getState().toggle()
  }
  const onOpenNeteasePlayer = () => {
    if (!neteaseSongId) return
    useNeteaseStore.getState().closePanel()
    useUiStore.getState().openPlayerPage({ kind: 'netease', songId: neteaseSongId })
  }
  const onPrevious = () => {
    if (usingNetease) void useNeteaseStore.getState().previousSong()
    else usePlayerStore.getState().prev()
  }
  const onNext = () => {
    if (usingNetease) void useNeteaseStore.getState().nextSong()
    else usePlayerStore.getState().next({ wrap: true })
  }
  const onSeekTo = (time: number) => {
    if (scrubTimeRef.current === null) return
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = null
    scrubTimeRef.current = null
    setScrubTime(null)
    if (usingNetease) void useNeteaseStore.getState().seekTo(time)
    else usePlayerStore.getState().seekTo(time)
  }
  const onSeekChange = (time: number) => {
    scrubTimeRef.current = time
    setScrubTime(time)
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    // 某些 Chromium 版本拖动 range 时不向 input 派发 pointerup；停下拖动后仍提交。
    seekTimerRef.current = setTimeout(() => onSeekTo(time), 600)
  }
  const onClose = () => {
    // 仅隐藏悬浮栏，音乐继续播放，通过工具栏图标重新打开。
    if (usingNetease) useNeteaseStore.getState().setFloatingVisible(false)
    else usePlayerStore.getState().setBarVisible(false)
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={track?.url}
        preload="metadata"
        onPlay={(event) =>
          usePlayerStore.setState((s) => ({
            playing: true,
            time: event.currentTarget.currentTime,
            duration:
              Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0
                ? event.currentTarget.duration
                : s.duration,
          }))
        }
        onPause={() => usePlayerStore.setState({ playing: false })}
        onTimeUpdate={(event) => usePlayerStore.setState({ time: event.currentTarget.currentTime })}
        onLoadedMetadata={(event) => usePlayerStore.setState({ duration: event.currentTarget.duration })}
        onDurationChange={(event) => usePlayerStore.setState({ duration: event.currentTarget.duration })}
        onEnded={() => notifyEngineEnded()}
      />
      {shown && (
        <div
          ref={barRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
          className={`fixed z-[300] flex touch-none select-none items-center gap-2 rounded-full border border-edge bg-panel/95 py-2 pl-2 pr-2 shadow-2xl backdrop-blur ${dragPos ? '' : 'right-4 top-4'} ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          title="拖动可移动悬浮窗"
        >
          <button type="button" title={collapsed ? '展开' : '收起'} className="rounded-full p-1.5 text-soft hover:bg-hover hover:text-main" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
          {!collapsed && (
            <div className="w-44 min-w-0">
              <div className="flex items-center gap-2">
                {shownPlaying && <span className="sq-eq shrink-0"><span /><span /><span /></span>}
                {usingNetease ? (
                  <button type="button" className="truncate text-left text-xs font-medium hover:text-rose-400" title="打开音乐播放器" onClick={onOpenNeteasePlayer}>
                    <span className="mr-1 text-[9px] font-normal text-rose-400">网易云</span>{name}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenPlayer}
                    className="truncate text-xs font-medium hover:text-sky-400"
                    title={playlistName ? `打开音乐播放器(歌单「${playlistName}」)` : '打开音乐播放器'}
                  >
                    {playlistName && (
                      <span className="mr-1 text-[9px] font-normal text-sky-400/90">「{playlistName}」</span>
                    )}
                    {name}
                  </button>
                )}
              </div>
              <div className="mt-0.5 text-[10px] tabular-nums text-dim">{fmtTime(seekTime)} / {fmtTime(shownDuration)}</div>
              <input
                type="range"
                aria-label="播放进度"
                min={0}
                max={shownDuration || 0}
                step={0.1}
                value={Math.min(Math.max(seekTime, 0), shownDuration || 0)}
                disabled={shownDuration <= 0}
                onChange={(event) => onSeekChange(Number(event.target.value))}
                onPointerUp={(event) => onSeekTo(Number(event.currentTarget.value))}
                onKeyUp={(event) => onSeekTo(Number(event.currentTarget.value))}
                onBlur={(event) => onSeekTo(Number(event.currentTarget.value))}
                className="sq-range mt-1.5 block w-full disabled:cursor-default disabled:opacity-40"
                style={{ '--sq-fill': `${progress}%`, '--sq-accent': usingNetease ? '#f43f5e' : '#38bdf8' } as CSSProperties}
              />
            </div>
          )}
          <div className="flex items-center gap-1">
            <button type="button" title="上一首" disabled={usingNetease && disableNeteasePrevious} className="rounded-full p-2 text-soft hover:bg-hover hover:text-main disabled:opacity-40" onClick={onPrevious}><PrevIcon /></button>
            <button type="button" title={shownPlaying ? '暂停' : '播放'} className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${usingNetease ? 'bg-rose-500 hover:bg-rose-400' : 'bg-sky-500 hover:bg-sky-400'}`} onClick={onToggle}>
              {shownPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4 translate-x-px" />}
            </button>
            <button type="button" title="下一首" disabled={usingNetease && disableNeteaseNext} className="rounded-full p-2 text-soft hover:bg-hover hover:text-main disabled:opacity-40" onClick={onNext}><NextIcon /></button>
          </div>
          {!collapsed && (
            <>
              {!usingNetease && isPipSupported() && (
                <button type="button" title="最小化悬浮窗（桌面级小窗）" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={() => { openPip(); onClose() }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M14 14h6v6" /><rect x="14" y="14" width="6" height="6" rx="1" fill="currentColor" stroke="none" /></svg>
                </button>
              )}
              <button type="button" title="隐藏悬浮窗（音乐继续播放）" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={onClose}><CloseIcon /></button>
            </>
          )}
        </div>
      )}
    </>
  )
}
