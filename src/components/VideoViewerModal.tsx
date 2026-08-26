import { useEffect, useRef } from 'react'
import { CloseIcon, DownloadIcon } from '../canvas/nodes/Icons'
import { registerVideo } from '../media/mediaCoordinator'
import { useAssetUrl } from '../media/useAssetUrl'
import { useUiStore } from '../store/uiStore'

/** 视频查看器：全屏叠加层播放视频（画布节点不再内嵌播放器） */
export function VideoViewerModal() {
  const viewer = useUiStore((s) => s.videoViewer)
  const close = useUiStore((s) => s.closeVideoViewer)
  const url = useAssetUrl(viewer?.assetId)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!viewer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, close])

  // 注册到全局媒体协调器：播放时暂停其他视频元素
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    return registerVideo(el)
  }, [url])

  if (!viewer) return null

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[var(--overlay)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-soft">{viewer.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={url}
            download={viewer.name}
            title="下载视频"
            className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
          >
            <DownloadIcon />
          </a>
          <button
            type="button"
            title="关闭"
            aria-label="关闭视频"
            className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            controls
            autoPlay
            playsInline
            draggable={false}
            className="max-h-full max-w-full rounded-lg bg-black"
          />
        ) : (
          <div className="text-xs text-dim">视频加载中…</div>
        )}
      </div>
    </div>
  )
}
