import { memo, useRef } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useAssetUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { MediaNodeShell } from './MediaNodeShell'

const MAX_W = 480
const MAX_H = 360

export const ImageNode = memo(function ImageNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const fittedRef = useRef(false)

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (fittedRef.current) return
    fittedRef.current = true
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (!w || !h) return
    const scale = Math.min(MAX_W / w, MAX_H / h, 1)
    onNodesChange([
      {
        id: props.id,
        type: 'dimensions',
        setAttributes: true,
        dimensions: {
          width: Math.max(48, Math.round(w * scale)),
          height: Math.max(48, Math.round(h * scale)),
        },
      },
    ])
  }

  return (
    <MediaNodeShell node={props}>
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-[var(--well)] p-1.5">
        {url ? (
          <img
            src={url}
            alt={props.data.label ?? ''}
            draggable={false}
            onLoad={handleLoad}
            className="max-h-full max-w-full rounded object-contain"
          />
        ) : (
          <div className="h-16 w-16 animate-pulse rounded bg-hover/60" />
        )}
      </div>
    </MediaNodeShell>
  )
})
