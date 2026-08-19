import { memo, useRef } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useAssetUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore, toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { DownloadIcon, OpenIcon } from './Icons'
import { useLanStore } from '../../store/lanStore'
import { clearLanEditing, setLanEditing } from '../../sync/lanClient'

const MAX_W = 480
const MAX_H = 360

export const ImageNode = memo(function ImageNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const openImageViewer = useUiStore((s) => s.openImageViewer)
  const lock = useLanStore((s) =>
    Object.values(s.editing).find((item) => item.nodeId === props.id && item.userId !== s.selfId),
  )
  const fittedRef = useRef(false)
  const filename = props.data.label ?? '图片'

  const openImage = () => {
    if (!url || !props.data.assetId) {
      toast('图片仍在加载，请稍后重试', 'info')
      return
    }
    openImageViewer(props.data.assetId, filename)
  }

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
    <>
      <NodeResizer
        isVisible={props.selected && !lock}
        minWidth={48}
        minHeight={48}
        keepAspectRatio={false}
        onResizeStart={() => setLanEditing(props.id, filename)}
        onResizeEnd={() => clearLanEditing()}
        lineClassName="!border-sky-400"
        handleClassName="!h-2.5 !w-2.5 !border-sky-300 !bg-sky-600"
      />
      <MediaNodeShell node={props}>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--well)] p-1.5"
        onDoubleClick={(event) => {
          event.stopPropagation()
          openImage()
        }}
      >
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
        <div className="nodrag absolute right-2 top-2 flex gap-1 rounded-md border border-edge bg-panel/90 p-1 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title="打开图片"
            aria-label="打开图片"
            disabled={!url}
            className="rounded p-1.5 text-soft hover:bg-hover hover:text-main disabled:cursor-wait disabled:opacity-35"
            onClick={(event) => {
              event.stopPropagation()
              openImage()
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <OpenIcon />
          </button>
          <a
            href={url}
            download={filename}
            title="下载图片"
            aria-label="下载图片"
            className={`rounded p-1.5 text-soft hover:bg-hover hover:text-main ${url ? '' : 'pointer-events-none opacity-35'}`}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <DownloadIcon />
          </a>
        </div>
      </div>
      </MediaNodeShell>
    </>
  )
})
