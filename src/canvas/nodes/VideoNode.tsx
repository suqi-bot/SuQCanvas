import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useAssetUrl, useThumbnailUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'

const MAX_W = 640
const MAX_H = 360

export const VideoNode = memo(function VideoNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const poster = useThumbnailUrl(props.data.assetId)
  const updateNodeStyle = useCanvasStore((s) => s.updateNodeStyle)
  const fittedRef = useRef(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(true)

  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries[0]?.isIntersecting ?? true)
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const handleMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (fittedRef.current) return
    fittedRef.current = true
    const w = e.currentTarget.videoWidth
    const h = e.currentTarget.videoHeight
    if (!w || !h) return
    const scale = Math.min(MAX_W / w, MAX_H / h, 1)
    updateNodeStyle(props.id, { width: Math.max(96, Math.round(w * scale)), height: Math.max(72, Math.round(h * scale)) })
  }

  return (
    <MediaNodeShell node={props}>
      <div ref={boxRef} className="flex h-full w-full items-center justify-center overflow-hidden bg-[var(--well)]">
        {!url ? (
          <div className="h-20 w-20 animate-pulse rounded bg-hover/60" />
        ) : nearViewport ? (
          <video
            src={url}
            controls
            preload="metadata"
            poster={poster}
            draggable={false}
            onLoadedMetadata={handleMetadata}
            className="nodrag h-full w-full object-contain"
          />
        ) : (
          <img
            src={poster}
            alt=""
            draggable={false}
            className="h-full w-full object-contain"
          />
        )}
      </div>
    </MediaNodeShell>
  )
})
