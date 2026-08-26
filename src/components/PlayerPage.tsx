import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioPlayerView } from './AudioPlayer'
import { ChevronLeftIcon, CloseIcon, DownloadIcon } from '../canvas/nodes/Icons'
import { db, type AssetRecord } from '../db/db'
import { collectFiles } from '../media/managedFile'
import { registerVideo } from '../media/mediaCoordinator'
import { useAssetUrl, useThumbnailUrl } from '../media/useAssetUrl'
import { useCanvasStore } from '../store/canvasStore'
import { usePlayerStore } from '../store/playerStore'
import { useUiStore } from '../store/uiStore'

/**
 * 专用播放器页：画布音频/视频节点双击进入。
 * 音频页复用沉浸式 AudioPlayerView（封面背景/唱片/频谱/歌词/队列），
 * 视频页为沉浸式全屏播放（封面氛围背景 + 居中视频 + 顶栏操作）。
 */
export function PlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  if (!page) return null
  return page.kind === 'audio' ? <AudioPlayerPage /> : <VideoPlayerPage />
}

function AudioPlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  const close = useUiStore((s) => s.closePlayerPage)
  const nodes = useCanvasStore((s) => s.nodes)
  const [records, setRecords] = useState<Map<string, AssetRecord>>(new Map())
  const assetIds = useMemo(
    () => [...new Set(nodes.map((node) => node.data.assetId).filter((id): id is string => Boolean(id)))],
    [nodes],
  )

  useEffect(() => {
    if (page?.kind !== 'audio') return
    let alive = true
    void db.assets.bulkGet(assetIds).then((items) => {
      if (!alive) return
      setRecords(
        new Map(
          items
            .filter((item): item is AssetRecord => Boolean(item))
            .map((item) => [item.id, item]),
        ),
      )
    })
    return () => {
      alive = false
    }
  }, [assetIds, page])

  const files = useMemo(() => collectFiles(nodes, records), [nodes, records])
  if (page?.kind !== 'audio') return null
  return (
    <AudioPlayerView
      files={files}
      initialAssetId={page.assetId}
      initialFlow={page.flow}
      initialPlaylistId={page.playlistId}
      onBack={close}
      onClose={close}
    />
  )
}

function VideoPlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  const close = useUiStore((s) => s.closePlayerPage)
  const assetId = page?.kind === 'video' ? page.assetId : undefined
  const url = useAssetUrl(assetId)
  const poster = useThumbnailUrl(assetId)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (page?.kind !== 'video') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, close])

  // 注册到全局媒体协调器：播放时暂停其他视频元素
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    return registerVideo(el)
  }, [url])

  // 播放页期间隐藏音频悬浮窗（其 z-300 高于播放页），关闭时恢复
  useEffect(() => {
    usePlayerStore.getState().setBarVisible(false)
    return () => {
      const state = usePlayerStore.getState()
      if (state.track && (state.playing || state.time > 0)) state.setBarVisible(true)
    }
  }, [])

  if (page?.kind !== 'video') return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#04060a]">
      {/* 氛围背景：封面缩略图模糊铺满 + 上下渐变 */}
      <div className="absolute inset-0" aria-hidden>
        {poster ? (
          <img src={poster} alt="" className="h-full w-full scale-110 object-cover opacity-50 blur-2xl" draggable={false} />
        ) : (
          <div className="h-full w-full bg-gradient-to-b from-[#0a0f1a] to-[#04060a]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/55" />
      </div>

      {/* 顶栏 */}
      <header className="relative z-10 flex items-center gap-3 px-5 pt-5">
        <button
          type="button"
          onClick={close}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3.5 py-2 text-xs text-white/85 backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          返回
        </button>
        <h1 className="min-w-0 truncate text-sm font-medium text-white/85" title={page.name}>
          {page.name}
        </h1>
        <div className="flex-1" />
        <a
          href={url}
          download={page.name}
          title="下载视频"
          aria-label="下载视频"
          className="rounded-full border border-white/10 bg-black/30 p-2.5 text-white/85 backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white"
        >
          <DownloadIcon />
        </a>
        <button
          type="button"
          onClick={close}
          title="关闭"
          aria-label="关闭播放器"
          className="rounded-full border border-white/10 bg-black/30 p-2.5 text-white/85 backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white"
        >
          <CloseIcon />
        </button>
      </header>

      {/* 视频区：占满剩余区域，按比例缩放填充 */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 pb-14 pt-4">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            controls
            autoPlay
            playsInline
            draggable={false}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <span className="text-xs text-white/50">视频加载中…</span>
          </div>
        )}
      </div>
    </div>
  )
}
