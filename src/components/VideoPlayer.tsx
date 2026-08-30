import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from 'react'
import {
  ChevronLeftIcon,
  CloseIcon,
  DownloadIcon,
  ExitFullscreenIcon,
  ForwardIcon,
  FullscreenIcon,
  MoonIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PiPIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RewindIcon,
  SearchIcon,
  SunIcon,
  VideoIcon,
  VolumeIcon,
} from '../canvas/nodes/Icons'
import { db } from '../db/db'
import { getAssetUrl, getThumbnailUrl } from '../media/blobRegistry'
import { registerVideo } from '../media/mediaCoordinator'
import type { ManagedFile } from '../media/managedFile'
import { useAssetUrl } from '../media/useAssetUrl'
import { usePlayerStore } from '../store/playerStore'
import { useSettingsStore } from '../store/settingsStore'
import { toast } from '../store/uiStore'

const SEEK_STEP = 10
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 沉浸式视频播放器：氛围封面背景 + 顶栏 + 居中视频 + 自定义控制栏（进度/缓冲、
 * 播放暂停、快退快进、上一集/下一集、音量、倍速、画中画、全屏）+ 右侧视频列表侧边栏。
 * 键盘：空格播放暂停、←/→ 快退快进、↑/↓ 音量、M 静音、F 全屏、L 列表、Esc 关闭。
 */
export function VideoPlayerView({
  files,
  initialAssetId,
  onBack,
  onClose,
}: {
  files: ManagedFile[]
  initialAssetId: string
  onBack: () => void
  onClose: () => void
}) {
  const videoFiles = useMemo(() => files.filter((file) => file.kind === 'video'), [files])
  const [currentId, setCurrentId] = useState(initialAssetId)
  const url = useAssetUrl(currentId)

  // 早晚主题（与工具栏共用同一开关）
  const theme = useSettingsStore((state) => state.theme)
  const toggleTheme = useSettingsStore((state) => state.toggleTheme)

  // 当前视频文件
  const current = useMemo(
    () => videoFiles.find((file) => file.assetId === currentId),
    [videoFiles, currentId],
  )

  // 初始 assetId 不在列表（素材尚未加载）时自动定位到第一个视频
  useEffect(() => {
    if (videoFiles.length === 0) return
    if (!videoFiles.some((file) => file.assetId === currentId)) {
      setCurrentId(videoFiles[0].assetId)
    }
  }, [videoFiles, currentId])

  // 批量加载所有视频缩略图（列表项 + 当前视频海报）
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let alive = true
    void Promise.all(
      videoFiles.map(async (file) => {
        try {
          const thumb = await getThumbnailUrl(file.assetId)
          return thumb ? ([file.assetId, thumb] as const) : null
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (alive) {
        setThumbs(
          new Map(
            entries.filter((entry): entry is readonly [string, string] => Boolean(entry)),
          ),
        )
      }
    })
    return () => {
      alive = false
    }
  }, [videoFiles])

  // 批量探测视频时长（列表项缩略图上的时长角标；仅读元数据，不下载完整文件）
  const [durations, setDurations] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (videoFiles.length === 0) return
    let alive = true
    const probes: HTMLVideoElement[] = []
    void Promise.all(
      videoFiles.map(async (file) => {
        try {
          const assetUrl = await getAssetUrl(file.assetId)
          const probe = document.createElement('video')
          probe.preload = 'metadata'
          probe.muted = true
          probes.push(probe)
          const duration = await new Promise<string>((resolve) => {
            probe.onloadedmetadata = () => {
              resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? formatTime(probe.duration) : '')
            }
            probe.onerror = () => resolve('')
            probe.src = assetUrl
          })
          return duration ? ([file.assetId, duration] as const) : null
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (!alive) return
      setDurations(
        new Map(
          entries.filter((entry): entry is readonly [string, string] => Boolean(entry)),
        ),
      )
    }).finally(() => {
      probes.forEach((probe) => {
        probe.removeAttribute('src')
        probe.load()
      })
    })
    return () => {
      alive = false
      probes.forEach((probe) => {
        probe.removeAttribute('src')
        probe.load()
      })
    }
  }, [videoFiles])

  // ---- 播放状态 ----
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const autoplayRef = useRef(true) // 首次进入 / 切换视频后自动播放
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [listOpen, setListOpen] = useState(true) // 非全屏时右侧列表常驻显示
  const [rateMenuOpen, setRateMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [pip, setPip] = useState(false)
  const [seekDragging, setSeekDragging] = useState(false)
  const [dragTime, setDragTime] = useState<number | null>(null)

  const visibleFiles = useMemo(() => {
    const keyword = query.normalize('NFKC').toLocaleLowerCase().trim()
    if (!keyword) return videoFiles
    return videoFiles.filter(
      (file) =>
        file.name.toLocaleLowerCase().includes(keyword) ||
        (file.nodes[0]?.data.createdByName ?? '').toLocaleLowerCase().includes(keyword),
    )
  }, [videoFiles, query])

  // ---- 播放控制 ----
  const toggle = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }, [])

  const seekTo = useCallback((target: number) => {
    const el = videoRef.current
    if (!el) return
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : target
    el.currentTime = Math.max(0, Math.min(target, max))
    setTime(el.currentTime)
    setDragTime(null)
  }, [])

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current
      if (!el) return
      seekTo(el.currentTime + delta)
    },
    [seekTo],
  )

  const switchTo = useCallback(
    (assetId: string) => {
      if (assetId === currentId) return
      autoplayRef.current = true
      setCurrentId(assetId)
      setTime(0)
      setDuration(0)
      setBuffered(0)
      setDragTime(null)
    },
    [currentId],
  )

  const playPrev = useCallback(() => {
    const index = videoFiles.findIndex((file) => file.assetId === currentId)
    if (index < 0 || videoFiles.length < 2) return
    switchTo(videoFiles[index > 0 ? index - 1 : videoFiles.length - 1].assetId)
  }, [videoFiles, currentId, switchTo])

  const playNext = useCallback(() => {
    const index = videoFiles.findIndex((file) => file.assetId === currentId)
    if (videoFiles.length < 2) {
      const el = videoRef.current
      if (el) el.currentTime = 0
      return
    }
    if (index < 0) return
    switchTo(videoFiles[index + 1 < videoFiles.length ? index + 1 : 0].assetId)
  }, [videoFiles, currentId, switchTo])

  const applyVolume = useCallback((value: number) => {
    const next = Math.max(0, Math.min(1, value))
    setVolume(next)
    setMuted(next === 0)
    const el = videoRef.current
    if (el) {
      el.volume = next
      el.muted = next === 0
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      const el = videoRef.current
      if (el) el.muted = next
      return next
    })
  }, [])

  const applyRate = useCallback((value: number) => {
    setRate(value)
    setRateMenuOpen(false)
    const el = videoRef.current
    if (el) el.playbackRate = value
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }, [])

  const togglePip = useCallback(async () => {
    const el = videoRef.current
    if (!el) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await el.requestPictureInPicture()
    } catch {
      toast('当前浏览器不支持画中画', 'error')
    }
  }, [])

  // ---- 全屏 / 画中画状态同步 ----
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const onEnter = () => setPip(true)
    const onLeave = () => setPip(false)
    document.addEventListener('enterpictureinpicture', onEnter)
    document.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      document.removeEventListener('enterpictureinpicture', onEnter)
      document.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [])

  // ---- video 元素事件 ----
  const handleLoadedData = useCallback(() => {
    const el = videoRef.current
    if (!el || !autoplayRef.current) return
    autoplayRef.current = false
    void el.play().catch(() => undefined)
  }, [])

  const handleEnded = useCallback(() => {
    playNext()
  }, [playNext])

  // 注册到全局媒体协调器：播放时暂停其他视频元素
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    return registerVideo(el)
  }, [url])

  // 音量 / 倍速同步到视频元素（切换 src 后重新应用）
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.volume = volume
    el.muted = muted
    el.playbackRate = rate
  }, [volume, muted, rate, url])

  // 播放页期间隐藏音频悬浮窗（其 z-300 高于播放页），关闭时恢复
  useEffect(() => {
    usePlayerStore.getState().setBarVisible(false)
    return () => {
      const state = usePlayerStore.getState()
      if (state.track && (state.playing || state.time > 0)) state.setBarVisible(true)
    }
  }, [])

  // 全屏时：顶栏/底栏随鼠标移动显示，闲置后自动隐藏；非全屏保持常驻
  useEffect(() => {
    if (!fullscreen) {
      setControlsVisible(true)
      return
    }
    let timer = 0
    const show = () => {
      setControlsVisible(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setControlsVisible(false), 2200)
    }
    show()
    window.addEventListener('mousemove', show)
    window.addEventListener('mousedown', show)
    window.addEventListener('touchstart', show)
    return () => {
      window.removeEventListener('mousemove', show)
      window.removeEventListener('mousedown', show)
      window.removeEventListener('touchstart', show)
      window.clearTimeout(timer)
    }
  }, [fullscreen])

  // ---- 键盘快捷键 ----
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const target = event.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      switch (event.code) {
        case 'Space':
          event.preventDefault()
          toggle()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekBy(-SEEK_STEP)
          break
        case 'ArrowRight':
          event.preventDefault()
          seekBy(SEEK_STEP)
          break
        case 'ArrowUp':
          event.preventDefault()
          applyVolume(volume + 0.1)
          break
        case 'ArrowDown':
          event.preventDefault()
          applyVolume(volume - 0.1)
          break
        case 'KeyM':
          event.preventDefault()
          toggleMute()
          break
        case 'KeyF':
          event.preventDefault()
          toggleFullscreen()
          break
        case 'KeyL':
          event.preventDefault()
          setListOpen((value) => !value)
          break
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen()
          else if (listOpen) setListOpen(false)
          else if (rateMenuOpen) setRateMenuOpen(false)
          else onClose()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle, seekBy, applyVolume, volume, toggleMute, toggleFullscreen, listOpen, rateMenuOpen, onClose])

  // ---- 进度条拖拽 ----
  const progressTime = dragTime ?? time
  const progress = duration > 0 ? (Math.min(progressTime, duration) / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (Math.min(buffered, duration) / duration) * 100 : 0

  const seekFromPointer = (clientX: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const el = videoRef.current
    const max = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
    setDragTime(ratio * max)
  }

  const onSeekPointerDown = (event: RPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const el = videoRef.current
    if (!el || !(Number.isFinite(el.duration) && el.duration > 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setSeekDragging(true)
    seekFromPointer(event.clientX, event.currentTarget)
  }
  const onSeekPointerMove = (event: RPointerEvent<HTMLDivElement>) => {
    if (!seekDragging) return
    seekFromPointer(event.clientX, event.currentTarget)
  }
  const onSeekPointerUp = (event: RPointerEvent<HTMLDivElement>) => {
    if (!seekDragging) return
    setSeekDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (dragTime != null) seekTo(dragTime)
  }

  // ---- 下载当前视频 ----
  const downloadCurrent = async () => {
    if (!current || !url) return
    try {
      const record = await db.assets.get(current.assetId)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = record?.name ?? current.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      toast('已开始下载', 'success')
    } catch {
      toast('下载失败', 'error')
    }
  }

  // ---- 空状态 ----
  if (videoFiles.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#04060a]">
        <VideoIcon className="h-12 w-12 text-white/25" />
        <p className="text-sm text-white/60">画布上还没有视频文件</p>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/80 backdrop-blur transition-colors hover:bg-white/15"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          返回画布
        </button>
      </div>
    )
  }

  const name = current?.name ?? '视频'
  const poster = currentId ? thumbs.get(currentId) : undefined

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#04060a] ${fullscreen && !controlsVisible ? 'cursor-none' : ''}`}
    >
      {/* 氛围背景：当前视频封面模糊铺满 + 上下渐变 */}
      <div className="absolute inset-0" aria-hidden>
        {poster ? (
          <img
            src={poster}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-40 blur-2xl"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-b from-[#0a0f1a] to-[#04060a]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/5 to-black/60" />
      </div>

      {/* 顶栏：非全屏常驻布局；全屏时覆盖在视频上层，随鼠标移动显示，闲置隐藏 */}
      <header
        className={`flex items-center gap-3 border-b border-edge bg-panel px-4 py-3 transition-opacity duration-300 sm:px-5 ${fullscreen ? 'absolute left-0 right-0 top-0 z-30' : 'relative z-10'} ${fullscreen && !controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-full border border-edge bg-panel2 px-3.5 py-2 text-xs text-main transition-colors hover:bg-hover hover:text-main"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          返回
        </button>
        <h1 className="min-w-0 truncate text-sm font-medium text-main" title={name}>
          {name}
        </h1>
        <div className="flex-1" />
        {!fullscreen && (
          <>
            <span className="hidden rounded-full border border-edge bg-panel2 px-3 py-1.5 text-xs text-dim sm:inline">
              共 {videoFiles.length} 个视频
            </span>
            <button
              type="button"
              onClick={() => setListOpen((value) => !value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${listOpen ? 'border-transparent bg-sky-500 text-slate-950' : 'border-edge bg-panel2 text-main hover:bg-hover hover:text-main'}`}
              title="视频列表"
            >
              <QueueIcon className="h-3.5 w-3.5" />
              列表
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          className="rounded-full border border-edge bg-panel2 p-2.5 text-main transition-colors hover:bg-hover hover:text-main"
        >
          {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => void downloadCurrent()}
          title="下载视频"
          aria-label="下载视频"
          className="rounded-full border border-edge bg-panel2 p-2.5 text-main transition-colors hover:bg-hover hover:text-main"
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="关闭"
          aria-label="关闭播放器"
          className="rounded-full border border-edge bg-panel2 p-2.5 text-main transition-colors hover:bg-hover hover:text-main"
        >
          <CloseIcon />
        </button>
      </header>

      {/* 主体：左侧视频列 + 右侧常驻列表；全屏时铺满整个画面 */}
      <div className={`${fullscreen ? 'absolute inset-0 z-10' : 'relative z-10 flex min-h-0 flex-1'}`}>
        {/* 左侧列：视频画面 + 底部控制栏；全屏时铺满 */}
        <div className={`${fullscreen ? 'absolute inset-0' : 'flex min-h-0 min-w-0 flex-1 flex-col'}`}>
          {/* 视频区：点击切换播放/暂停；全屏时铺满画面但保持视频纵横比（内容完整不裁剪），非全屏黑色垫底占满左侧空间 */}
          <div
            className={`${fullscreen ? 'absolute inset-0 flex items-center justify-center overflow-hidden bg-black' : 'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black px-2 pt-2 sm:px-4 sm:pt-3'}`}
            onClick={toggle}
          >
        {url ? (
          <video
            ref={videoRef}
            src={url}
            poster={poster}
            playsInline
            preload="metadata"
            draggable={false}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onProgress={() => {
              const el = videoRef.current
              if (el && el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1))
            }}
            onLoadedData={handleLoadedData}
            onEnded={handleEnded}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <span className="text-xs text-white/50">视频加载中…</span>
          </div>
        )}
      </div>

          {/* 底部控制栏：纯色面板，响应早晚主题；非全屏常驻布局，全屏时覆盖在视频上层，随鼠标移动显示 */}
          <footer
            className={`border-t border-edge bg-panel px-4 py-3 transition-opacity duration-300 sm:px-6 sm:py-4 ${fullscreen ? 'absolute bottom-0 left-0 right-0 z-30' : ''} ${fullscreen && !controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          >
            <div className="transition-opacity duration-300 opacity-100">
        <div className="w-full">
          {/* 进度行 */}
          <div className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-dim">
              {formatTime(progressTime)}
            </span>
            <div
              role="slider"
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(progressTime)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') seekBy(-5)
                else if (event.key === 'ArrowRight') seekBy(5)
              }}
              onPointerDown={onSeekPointerDown}
              onPointerMove={onSeekPointerMove}
              onPointerUp={onSeekPointerUp}
              onPointerCancel={onSeekPointerUp}
              className={`group relative flex h-5 flex-1 cursor-pointer touch-none items-center py-1.5 ${seekDragging ? 'cursor-grabbing' : ''}`}
            >
              <div className="relative h-1 w-full overflow-hidden rounded-full bg-edge2/60 transition-[height] group-hover:h-1.5">
                <div
                  className="absolute inset-y-0 left-0 bg-mid/40"
                  style={{ width: `${bufferedPct}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-sky-400"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-main shadow-[0_0_0_4px_rgba(56,189,248,0.25)] transition-opacity ${seekDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ left: `${progress}%` }}
              />
            </div>
            <span className="w-12 shrink-0 text-[11px] tabular-nums text-dim">
              {formatTime(duration)}
            </span>
          </div>

          {/* 按钮行 */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main"
                title={muted || volume === 0 ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
              </button>
              <input
                aria-label="音量"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(event) => applyVolume(Number(event.target.value))}
                className="sq-range hidden w-20 sm:block"
                style={{ '--sq-fill': `${volume * 100}%` } as CSSProperties}
              />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRateMenuOpen((value) => !value)}
                  className={`rounded-full px-2.5 py-1.5 text-[11px] tabular-nums transition-colors ${rateMenuOpen ? 'bg-sky-500 text-slate-950' : 'text-mid hover:bg-hover hover:text-main'}`}
                  title="播放速度"
                >
                  {rate}x
                </button>
                {rateMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setRateMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-24 overflow-hidden rounded-lg border border-edge bg-panel py-1 shadow-2xl">
                      {RATES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => applyRate(value)}
                          className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${value === rate ? 'bg-sky-500/15 font-medium text-sky-400' : 'text-mid hover:bg-hover hover:text-main'}`}
                        >
                          {value}x
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={playPrev}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main disabled:opacity-30"
                title="上一集"
                disabled={videoFiles.length < 2}
              >
                <PrevIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => seekBy(-SEEK_STEP)}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main"
                title={`快退 ${SEEK_STEP} 秒`}
              >
                <RewindIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={toggle}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-slate-950 transition-transform hover:scale-105 active:scale-95"
                title={playing ? '暂停' : '播放'}
              >
                {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5 translate-x-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => seekBy(SEEK_STEP)}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main"
                title={`快进 ${SEEK_STEP} 秒`}
              >
                <ForwardIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={playNext}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main disabled:opacity-30"
                title="下一集"
                disabled={videoFiles.length < 2}
              >
                <NextIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void togglePip()}
                className={`rounded-full p-2 transition-colors ${pip ? 'bg-sky-500 text-slate-950' : 'text-mid hover:bg-hover hover:text-main'}`}
                title={pip ? '退出画中画' : '画中画'}
              >
                <PiPIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="rounded-full p-2 text-mid transition-colors hover:bg-hover hover:text-main"
                title={fullscreen ? '退出全屏' : '全屏'}
              >
                {fullscreen ? <ExitFullscreenIcon className="h-4 w-4" /> : <FullscreenIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
          </div>
        </footer>
        </div>

        {/* 右侧常驻列表（全屏时隐藏）：B 站风格，响应式宽度，小屏更窄优先保证视频区占满 */}
        {listOpen && !fullscreen && (
          <aside className="flex w-64 shrink-0 flex-col border-l border-edge bg-panel/95 backdrop-blur sm:w-72 xl:w-96">
            <div className="flex items-center gap-1 border-b border-edge px-2 py-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-main">
                <VideoIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                视频列表
                <span className="shrink-0 rounded-full bg-panel2 px-1.5 text-[10px] tabular-nums text-dim">
                  {videoFiles.length}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
                title="关闭列表"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="border-b border-edge p-2">
              <div className="flex items-center gap-2 rounded-md border border-edge2 bg-panel2 px-2.5 py-1.5">
                <SearchIcon className="shrink-0 text-mid" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索视频"
                  className="min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-dim"
                />
                {query && (
                  <button
                    type="button"
                    title="清空搜索"
                    className="text-dim hover:text-main"
                    onClick={() => setQuery('')}
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {visibleFiles.length > 0 ? (
                visibleFiles.map((file) => {
                  const isActive = file.assetId === currentId
                  const durationText = durations.get(file.assetId)
                  return (
                    <button
                      key={file.assetId}
                      type="button"
                      onClick={() => switchTo(file.assetId)}
                      className={`group relative flex w-full items-start gap-3 rounded-lg py-2 pl-3 pr-2.5 text-left transition-colors ${isActive ? 'bg-sky-500/15' : 'hover:bg-hover'}`}
                      title={isActive ? `正在播放：${file.name}` : `播放：${file.name}`}
                    >
                      {isActive && (
                        <span className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-sky-400" />
                      )}
                      {/* 16:9 缩略图 + 时长角标 */}
                      <span
                        className="relative w-32 shrink-0 overflow-hidden rounded-lg bg-panel2"
                        style={{ aspectRatio: '16 / 9' }}
                      >
                        {thumbs.get(file.assetId) ? (
                          <img
                            src={thumbs.get(file.assetId)}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center">
                            <VideoIcon className="h-5 w-5 text-dim" />
                          </span>
                        )}
                        {durationText && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px text-[10px] tabular-nums leading-tight text-white">
                            {durationText}
                          </span>
                        )}
                        {isActive && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                            {playing ? (
                              <PauseIcon className="h-5 w-5 text-white" />
                            ) : (
                              <PlayIcon className="h-5 w-5 text-white" />
                            )}
                          </span>
                        )}
                      </span>
                      {/* 标题 + 作者 */}
                      <span className="min-w-0 flex-1 py-0.5">
                        <span className={`line-clamp-2 text-xs leading-[1.4] ${isActive ? 'font-medium text-sky-400' : 'text-main'}`}>
                          {file.name}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-dim">
                          {file.nodes[0]?.data.createdByName ?? '未知'}
                        </span>
                        {isActive && (
                          <span className="mt-1 block text-[10px] text-sky-400">{playing ? '播放中' : '已暂停'}</span>
                        )}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="flex h-full min-h-32 items-center justify-center text-xs text-dim">
                  没有匹配的视频
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
