import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from '../canvas/nodes/Icons'
import { registerAudio } from '../media/mediaCoordinator'
import { findPlaylistByAsset, resolvePlaylistsCached } from '../media/playlists'
import { bindPlayerAudio, notifyEngineEnded, usePlayerStore } from '../store/playerStore'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'

function fmtTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

// 常驻的全局音频元素（唯一播放引擎）+ 播放中的右上角悬浮迷你控制栏。
// 画布音乐节点与播放器共用这一个元素与同一份播放状态。
export function GlobalPlayer() {
  const track = usePlayerStore((s) => s.track)
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.time)
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

  const shown = barVisible && track !== null
  const name = track?.name ?? ''

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
    usePlayerStore.getState().toggle()
  }
  const onSeek = (delta: number) => {
    usePlayerStore.getState().seekBy(delta)
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
            <div className="min-w-0 max-w-52">
              <div className="flex items-center gap-2">
                {playing && <span className="sq-eq shrink-0"><span /><span /><span /></span>}
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
            <button type="button" title="隐藏悬浮窗（音乐继续播放）" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" onClick={onClose}><CloseIcon /></button>
          )}
        </div>
      )}
    </>
  )
}
