import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AudioIcon, ChevronLeftIcon, CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon,
} from '../canvas/nodes/Icons'
import { useCoverPalette } from '../media/coverColor'
import { parseNeteaseTarget } from '../media/netease'
import { useCanvasStore } from '../store/canvasStore'
import { useNeteaseStore } from '../store/neteaseStore'
import { AudioBackground } from './AudioBackground'

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}

/** 网易云和本地 MP3 共用沉浸式播放器入口；音频仍由网易云网页容器输出。 */
export function NeteasePlayerView({
  songId,
  nodeId,
  onBack,
  onClose,
}: {
  songId: string
  nodeId?: string
  onBack: () => void
  onClose: () => void
}) {
  const activeSongId = useNeteaseStore((s) => s.activeSongId)
  const activeSongName = useNeteaseStore((s) => s.activeSongName)
  const queue = useNeteaseStore((s) => s.playQueue)
  const queueSource = useNeteaseStore((s) => s.queueSource)
  const playing = useNeteaseStore((s) => s.externalPlaying)
  const floatingVisible = useNeteaseStore((s) => s.floatingVisible)
  const currentTime = useNeteaseStore((s) => s.externalTime)
  const duration = useNeteaseStore((s) => s.externalDuration)
  const liked = useNeteaseStore((s) => s.liked)
  const searchResults = useNeteaseStore((s) => s.searchResults)
  const nodes = useCanvasStore((s) => s.nodes)
  const [queueOpen, setQueueOpen] = useState(false)
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const scrubRef = useRef<number | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const state = useNeteaseStore.getState()
    state.closePanel()
    state.setFloatingVisible(false)
    if (state.activeSongId !== songId) {
      const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
      void state.toggleSong(songId, node?.data.label, nodeId)
    } else if (nodeId) {
      state.useNodeFlow(nodeId, songId)
    }
    return () => {
      const latest = useNeteaseStore.getState()
      if (latest.activeSongId && (latest.externalPlaying || latest.externalTime > 0)) {
        latest.setFloatingVisible(true)
      }
    }
  }, [songId, nodeId])

  useEffect(() => {
    if (floatingVisible) useNeteaseStore.getState().setFloatingVisible(false)
  }, [floatingVisible])

  useEffect(() => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = null
    scrubRef.current = null
    setScrubTime(null)
  }, [activeSongId])

  useEffect(() => () => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
  }, [])

  const song = queue.find((item) => item.id === activeSongId)
    ?? liked?.songs.find((item) => item.id === activeSongId)
    ?? searchResults?.find((item) => item.id === activeSongId)
  const canvasSong = nodes.find((node) => {
    if (node.data.kind !== 'netease') return false
    const ref = parseNeteaseTarget(node.data.neteaseId)
    return ref?.type === 'song' && ref.id === (activeSongId ?? songId)
  })
  const name = activeSongName || song?.name || canvasSong?.data.label || `网易云歌曲 ${activeSongId ?? songId}`
  const artist = song?.artist || '网易云音乐'
  const coverUrl = song?.coverUrl || canvasSong?.data.neteaseCoverUrl
  const palette = useCoverPalette(coverUrl)
  const accent = palette?.accent ?? '#fb7185'
  const hue = palette?.hue ?? 346
  const shownTime = scrubTime ?? currentTime
  const progress = duration > 0 ? Math.min(100, Math.max(0, shownTime / duration * 100)) : 0
  const index = queue.findIndex((item) => item.id === activeSongId)
  const canPrevious = queue.length > 1 && (queueSource !== 'flow' || index > 0)
  const canNext = queue.length > 1 && (queueSource !== 'flow' || index < queue.length - 1)
  const displayedQueue = useMemo(
    () => queue.length > 0 ? queue : [{ id: activeSongId ?? songId, name, artist, coverUrl }],
    [queue, activeSongId, songId, name, artist, coverUrl],
  )

  const toggle = () => {
    const id = activeSongId ?? songId
    void useNeteaseStore.getState().toggleSong(id, name, nodeId)
  }
  const commitSeek = (time: number) => {
    if (scrubRef.current === null) return
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = null
    scrubRef.current = null
    setScrubTime(null)
    void useNeteaseStore.getState().seekTo(time)
  }
  const changeSeek = (time: number) => {
    scrubRef.current = time
    setScrubTime(time)
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = setTimeout(() => commitSeek(time), 600)
  }
  const selectSong = (id: string, songName: string) => {
    if (id === activeSongId) {
      if (!playing) toggle()
    } else {
      void useNeteaseStore.getState().playSong(id, songName, displayedQueue, queueSource)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (event.code === 'Space') {
        event.preventDefault()
        const state = useNeteaseStore.getState()
        void state.toggleSong(state.activeSongId ?? songId, state.activeSongName, nodeId)
      }
      if (event.code === 'ArrowLeft' && canPrevious) { event.preventDefault(); void useNeteaseStore.getState().previousSong() }
      if (event.code === 'ArrowRight' && canNext) { event.preventDefault(); void useNeteaseStore.getState().nextSong() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canPrevious, canNext, nodeId, songId])

  const queueList = (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
      {displayedQueue.map((item, position) => {
        const selected = item.id === activeSongId
        return (
          <button
            key={`${item.id}-${position}`}
            type="button"
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${selected ? 'bg-rose-500/15' : 'hover:bg-white/10'}`}
            onClick={() => selectSong(item.id, item.name)}
          >
            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-white/45">{position + 1}</span>
            {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10"><AudioIcon className="h-5 w-5 text-white/55" /></span>}
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${selected ? 'font-semibold text-rose-300' : 'text-white/85'}`}>{item.name}</span>
              <span className="block truncate text-[11px] text-white/45">{item.artist || '网易云音乐'}</span>
            </span>
            {selected && playing && <span className="sq-eq shrink-0"><span /><span /><span /></span>}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-app text-white" style={{ '--sq-accent': accent } as CSSProperties}>
      <AudioBackground coverUrl={coverUrl} playing={playing} hue={hue} tintRgb={palette?.tintRgb} />
      <div className="absolute inset-0 bg-slate-950/55" />

      <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3.5 py-2 text-xs text-white/85 backdrop-blur-md hover:bg-black/50">
          <ChevronLeftIcon className="h-3.5 w-3.5" />返回
        </button>
        <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-200 backdrop-blur-md">网易云音乐</span>
      </div>
      <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
        <button type="button" onClick={() => setQueueOpen((value) => !value)} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 backdrop-blur-md hover:bg-black/50 lg:hidden">
          <QueueIcon className="h-3.5 w-3.5" />队列
        </button>
        <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-black/30 p-2 text-white/85 backdrop-blur-md hover:bg-black/50" title="关闭播放器" aria-label="关闭播放器"><CloseIcon /></button>
      </div>

      <div className="relative z-10 flex h-full min-h-0 items-center justify-center gap-12 px-6 pb-40 pt-16 lg:px-12">
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center text-center">
          <div className="relative aspect-square w-[min(64vw,340px)] lg:w-[min(34vw,430px)]">
            <div className="sq-disc-halo pointer-events-none absolute -inset-[22%] rounded-full" aria-hidden="true" />
            <div className={`sq-disc absolute inset-0 rounded-full ${playing ? '' : 'sq-disc-paused'}`} style={{ boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 90px hsla(${hue} 85% 60% / 0.16)` }}>
              <div className="sq-disc-grooves absolute inset-0 rounded-full" />
              <div className="absolute inset-[9%] rounded-full border border-white/10" />
              <div className="absolute left-1/2 top-1/2 aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full ring-1 ring-white/25 shadow-2xl">
                {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="flex h-full w-full items-center justify-center bg-rose-950"><AudioIcon className="h-1/3 w-1/3 text-white/45" /></div>}
              </div>
              <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#04060a] ring-1 ring-white/25" />
            </div>
            <div className="sq-disc-shine pointer-events-none absolute inset-0 rounded-full" />
          </div>
          <h1 className="mt-9 max-w-full truncate text-2xl font-bold tracking-tight sm:text-3xl" title={name}>{name}</h1>
          <p className="mt-2 max-w-full truncate text-sm text-white/60">{artist}</p>
          <p className="mt-3 text-xs text-white/45">{queueSource === 'flow' ? '画布连线播放' : '网易云播放队列'}{index >= 0 ? ` · 第 ${index + 1} / ${queue.length} 首` : ''}</p>
        </section>
        <section className="hidden h-[min(65vh,560px)] w-[min(34vw,400px)] shrink-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/30 backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><QueueIcon className="h-4 w-4 text-rose-300" /><span className="font-semibold">播放队列</span><span className="ml-auto text-xs text-white/50">{displayedQueue.length} 首</span></div>
          {queueList}
        </section>
      </div>

      {queueOpen && <div className="absolute inset-0 z-30 bg-black/55 lg:hidden" onClick={() => setQueueOpen(false)} />}
      {queueOpen && <aside className="absolute inset-y-0 right-0 z-40 flex w-[min(85vw,360px)] flex-col border-l border-white/10 bg-slate-950/95 pt-16 shadow-2xl lg:hidden"><div className="flex items-center justify-between px-5 py-4"><span className="font-semibold">播放队列 · {displayedQueue.length} 首</span><button type="button" title="关闭队列" onClick={() => setQueueOpen(false)}><CloseIcon /></button></div>{queueList}</aside>}

      <footer className="absolute inset-x-0 bottom-0 z-20 px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-2xl rounded-[1.4rem] border border-white/10 bg-black/35 px-5 py-4 shadow-2xl backdrop-blur-xl sm:px-7 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/55">{formatTime(shownTime)}</span>
            <input aria-label="播放进度" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(Math.max(shownTime, 0), duration || 0)} disabled={duration <= 0} onChange={(event) => changeSeek(Number(event.target.value))} onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))} onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))} onBlur={(event) => commitSeek(Number(event.currentTarget.value))} className="sq-range min-w-0 flex-1 disabled:opacity-40" style={{ '--sq-fill': `${progress}%`, '--sq-accent': accent } as CSSProperties} />
            <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/55">{formatTime(duration)}</span>
          </div>
          <div className="mt-3 flex items-center justify-center gap-5">
            <button type="button" title="上一首" disabled={!canPrevious} onClick={() => void useNeteaseStore.getState().previousSong()} className="rounded-full p-3 text-white/75 transition-colors hover:bg-white/10 disabled:opacity-30"><PrevIcon className="h-6 w-6" /></button>
            <button type="button" title={playing ? '暂停' : '播放'} onClick={toggle} className="flex h-14 w-14 items-center justify-center rounded-full text-slate-950 transition-transform hover:scale-105 active:scale-95" style={{ background: accent }}>{playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6 translate-x-0.5" />}</button>
            <button type="button" title="下一首" disabled={!canNext} onClick={() => void useNeteaseStore.getState().nextSong()} className="rounded-full p-3 text-white/75 transition-colors hover:bg-white/10 disabled:opacity-30"><NextIcon className="h-6 w-6" /></button>
          </div>
        </div>
      </footer>
    </div>
  )
}
