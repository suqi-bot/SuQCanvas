import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, ZoomInIcon, ZoomOutIcon } from '../canvas/nodes/Icons'
import { useAssetSourceUrl, useAssetUrl, usePsdPreviewUrl } from '../media/useAssetUrl'
import { useUiStore } from '../store/uiStore'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function ImageViewerModal() {
  const viewer = useUiStore((s) => s.imageViewer)
  const close = useUiStore((s) => s.closeImageViewer)
  const imageUrl = useAssetSourceUrl(viewer?.thumbnail ? undefined : viewer?.assetId)
  const psdPreviewUrl = usePsdPreviewUrl(viewer?.thumbnail ? viewer.assetId : undefined)
  const url = viewer?.thumbnail ? psdPreviewUrl : imageUrl
  const downloadUrl = useAssetUrl(viewer?.assetId)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [fitZoom, setFitZoom] = useState(1)

  useEffect(() => {
    if (!viewer) return
    setNaturalSize({ width: 0, height: 0 })
    setZoom(1)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === '+' || event.key === '=') setZoom((value) => clampZoom(value * 1.2))
      if (event.key === '-') setZoom((value) => clampZoom(value / 1.2))
      if (event.key === '0') setZoom(fitZoom)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, close, fitZoom])

  if (!viewer) return null

  const fitImage = (width = naturalSize.width, height = naturalSize.height) => {
    if (!width || !height) return
    const viewport = viewportRef.current
    const availableWidth = Math.max(100, (viewport?.clientWidth ?? window.innerWidth) - 48)
    const availableHeight = Math.max(100, (viewport?.clientHeight ?? window.innerHeight - 48) - 48)
    const next = clampZoom(Math.min(availableWidth / width, availableHeight / height, 1))
    setFitZoom(next)
    setZoom(next)
  }

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[var(--overlay)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-soft">{viewer.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="缩小"
            className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
            onClick={() => setZoom((value) => clampZoom(value / 1.2))}
          >
            <ZoomOutIcon />
          </button>
          <button
            type="button"
            title="适应窗口"
            className="min-w-14 rounded-md px-2 py-1 text-xs tabular-nums text-soft hover:bg-hover"
            onClick={() => fitImage()}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title="放大"
            className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
            onClick={() => setZoom((value) => clampZoom(value * 1.2))}
          >
            <ZoomInIcon />
          </button>
          <a
            href={downloadUrl}
            download={viewer.name}
            title={viewer.thumbnail ? '下载原始 PSD' : '下载图片'}
            className={`rounded-md p-1.5 text-soft hover:bg-hover hover:text-main ${downloadUrl ? '' : 'pointer-events-none opacity-35'}`}
          >
            <DownloadIcon />
          </a>
          <button
            type="button"
            className="ml-1 rounded-md px-2 py-1 text-sm text-mid hover:bg-hover hover:text-main"
            onClick={close}
          >
            关闭
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
        onWheel={(event) => {
          event.preventDefault()
          setZoom((value) => clampZoom(value * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
        }}
      >
        <div className="flex min-h-full min-w-full items-center justify-center">
          {url ? (
            <img
              src={url}
              alt={viewer.name}
              draggable={false}
              className="max-w-none select-none rounded bg-white shadow-2xl"
              style={{
                width: naturalSize.width ? naturalSize.width * zoom : undefined,
                height: naturalSize.height ? naturalSize.height * zoom : undefined,
              }}
              onLoad={(event) => {
                const width = event.currentTarget.naturalWidth
                const height = event.currentTarget.naturalHeight
                setNaturalSize({ width, height })
                fitImage(width, height)
              }}
            />
          ) : (
            <div className="h-12 w-12 animate-pulse rounded-full bg-hover/60" />
          )}
        </div>
      </div>
    </div>
  )
}
