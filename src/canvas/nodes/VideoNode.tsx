import { memo, useRef } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useThumbnailUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { PlayIcon } from './Icons'

const MAX_W = 640
const MAX_H = 360

/**
 * 视频节点：画布上不内嵌播放器（原生控件/播放会抢占指针，影响拖拽节点），
 * 只显示封面缩略图 + 播放按钮，点击/双击打开全屏播放器；
 * 完整视频文件在打开播放器时才按需拉取，画布上不下载大文件。
 */
export const VideoNode = memo(function VideoNode(props: NodeProps<SuqNode>) {
  const poster = useThumbnailUrl(props.data.assetId)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const openVideoViewer = useUiStore((s) => s.openVideoViewer)
  const fittedRef = useRef(false)
  const filename = props.data.label ?? '视频'

  const openPlayer = () => {
    if (!props.data.assetId) return
    openVideoViewer(props.data.assetId, filename)
  }

  // 用封面缩略图的原生尺寸自适应节点大小（缩略图与视频同宽高比）
  const handlePosterLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (fittedRef.current) return
    fittedRef.current = true
    const w = e.currentTarget.naturalWidth
    const h = e.currentTarget.naturalHeight
    if (!w || !h) return
    const scale = Math.min(MAX_W / w, MAX_H / h, 1)
    onNodesChange([
      {
        id: props.id,
        type: 'dimensions',
        setAttributes: true,
        dimensions: {
          width: Math.max(96, Math.round(w * scale)),
          height: Math.max(72, Math.round(h * scale)),
        },
      },
    ])
  }

  return (
    <MediaNodeShell node={props}>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--well)]"
        onDoubleClick={(event) => {
          event.stopPropagation()
          openPlayer()
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            draggable={false}
            onLoad={handlePosterLoad}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="h-16 w-16 animate-pulse rounded bg-hover/60" />
        )}
        {/* 播放按钮：点击打开播放器；nodrag 保证不干扰节点拖拽 */}
        <button
          type="button"
          aria-label={`播放「${filename}」`}
          title="点击播放"
          onClick={(event) => {
            event.stopPropagation()
            openPlayer()
          }}
          className="nodrag absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/90 backdrop-blur transition hover:scale-105 hover:bg-black/60"
        >
          <PlayIcon />
        </button>
      </div>
    </MediaNodeShell>
  )
})
