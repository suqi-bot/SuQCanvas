import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from '../canvas/nodes/Icons'
import { registerAudio } from '../media/mediaCoordinator'
import { bindPlayerAudio, notifyPlayerEnded, usePlayerStore } from '../store/playerStore'
import { useUiStore } from '../store/uiStore'

function fmtTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

// 常驻的全局音频元素 + 播放中的右上角悬浮迷你控制栏。
// 支持两种来源：MP3 播放器（track，关闭播放器后继续接管）和画布音频节点（external）。
// 关闭悬浮栏才会停止并隐藏。
export function GlobalPlayer() {
  const source = usePlayerStore((s) => s.source)
  const track = usePlayerStore((s) => s.track)
  const external = usePlayerStore((s) => s.external)
  const trackPlaying = usePlayerStore((s) => s.trackPlaying)
  const externalPlaying = usePlayerStore((s) => s.externalPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const barVisible = usePlayerStore((s) => s.barVisible)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
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

  const usingExternal = source === 'external' && external !== null
  const shown = barVisible && (track !== null || external !== null)
  const playing = usingExternal ? externalPlaying : trackPlaying

  const name = usingExternal ? external!.name : (track?.name ?? '')
  const onOpenPlayer = () => {
    const player = usePlayerStore.getState()
    const assetId = player.source === 'external' ? player.external?.assetId : player.track?.assetId
    if (assetId) useUiStore.getState().openMusicPlayer(assetId, source === 'external')
  }
  const onToggle = () => {
    if (usingExternal) {
      const el = external!.element
      if (el.paused) void el.play().catch(() => undefined)
      else el.pause()
    } else {
      usePlayerStore.getState().toggle()
    }
  }
  const onSeek = (delta: number) => {
    if (usingExternal) {
      const el = external!.element
      const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : el.currentTime + delta
      el.currentTime = Math.max(0, Math.min(el.currentTime + delta, max))
      usePlayerStore.setState({ currentTime: el.currentTime })
    } else {
      usePlayerStore.getState().seekBy(delta)
    }
  }
  const onClose = () => {
    // 仅隐藏悬浮栏，音乐继续播放，通过工具栏 CD 图标重新打开播放器
    usePlayerStore.getState().setBarVisible(false)
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={track?.url}
        preload="metadata"
        onPlay={() => usePlayerStore.setState({ trackPlaying: true })}
        onPause={() => usePlayerStore.setState({ trackPlaying: false })}
        onTimeUpdate={(event) => usePlayerStore.setState({ trackTime: event.currentTarget.currentTime, currentTime: event.currentTarget.currentTime })}
        onLoadedMetadata={(event) => usePlayerStore.setState({ trackDuration: event.currentTarget.duration, duration: event.currentTarget.duration })}
        onDurationChange={(event) => usePlayerStore.setState({ trackDuration: event.currentTarget.duration, duration: event.currentTarget.duration })}
        onEnded={() => notifyPlayerEnded()}
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
            <div className="min-w-0 max-w-52">
              <div className="flex items-center gap-2">
                {playing && <span className="sq-eq shrink-0"><span /><span /><span /></span>}
                <button
                  type="button"
                  onClick={onOpenPlayer}
                  className="truncate text-xs font-medium hover:text-sky-400"
                  title="打开音乐播放器"
                >
                  {name}
                </button>
              </div>
              <div className="mt-0.5 text-[10px] tabular-nums text-dim">{fmtTime(currentTime)} / {fmtTime(duration)}</div>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button type="button" title="快退 10 秒" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={() => onSeek(-10)}><RewindIcon /></button>
            <button type="button" title={playing ? '暂停' : '播放'} className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white hover:bg-sky-400" onClick={onToggle}>
              {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4 translate-x-px" />}
            </button>
            <button type="button" title="快进 10 秒" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={() => onSeek(10)}><ForwardIcon /></button>
          </div>
          {!collapsed && (
            <button type="button" title="停止并关闭" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={onClose}><CloseIcon /></button>
          )}
        </div>
      )}
    </>
  )
}
