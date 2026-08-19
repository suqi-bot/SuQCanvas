import { memo, useRef } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useAssetUrl, usePsdPreviewUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore, toast } from '../../store/uiStore'
import { useLanStore } from '../../store/lanStore'
import { clearLanEditing, setLanEditing } from '../../sync/lanClient'
import { DownloadIcon, OpenIcon } from './Icons'
import { MediaNodeShell } from './MediaNodeShell'

const MAX_W = 480
const MAX_H = 360

export const PsdNode = memo(function PsdNode(props: NodeProps<SuqNode>) {
  const previewUrl = usePsdPreviewUrl(props.data.assetId)
  const originalUrl = useAssetUrl(props.data.assetId)
  const onNodesChange = useCanvasStore((state) => state.onNodesChange)
  const openImageViewer = useUiStore((state) => state.openImageViewer)
  const lock = useLanStore((state) =>
    Object.values(state.editing).find(
      (item) => item.nodeId === props.id && item.userId !== state.selfId,
    ),
  )
  const fittedRef = useRef(false)
  const filename = props.data.label ?? '未命名.psd'

  const openPreview = () => {
    if (lock) {
      toast(`${lock.name} 正在操作此元素`, 'info')
      return
    }
    if (!previewUrl || !props.data.assetId) {
      toast('PSD 预览仍在生成，请稍后重试', 'info')
      return
    }
    openImageViewer(props.data.assetId, filename, true)
  }

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (fittedRef.current) return
    fittedRef.current = true
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget
    if (!width || !height) return
    const scale = Math.min(MAX_W / width, MAX_H / height, 1)
    onNodesChange([
      {
        id: props.id,
        type: 'dimensions',
        setAttributes: true,
        dimensions: {
          width: Math.max(120, Math.round(width * scale)),
          height: Math.max(90, Math.round(height * scale)),
        },
      },
    ])
  }

  return (
    <>
      <NodeResizer
        isVisible={props.selected && !lock}
        minWidth={120}
        minHeight={90}
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
            openPreview()
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={filename}
              draggable={false}
              onLoad={handleLoad}
              className="max-h-full max-w-full rounded object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-xs text-dim">
              <div className="h-10 w-10 animate-pulse rounded bg-hover/60" />
              正在生成 PSD 预览
            </div>
          )}
          <div className="nodrag absolute right-2 top-2 flex gap-1 rounded-md border border-edge bg-panel/90 p-1 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="打开 PSD 预览"
              aria-label="打开 PSD 预览"
              disabled={!previewUrl}
              className="rounded p-1.5 text-soft hover:bg-hover hover:text-main disabled:cursor-wait disabled:opacity-35"
              onClick={(event) => {
                event.stopPropagation()
                openPreview()
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <OpenIcon />
            </button>
            <a
              href={originalUrl}
              download={filename}
              title="下载原始 PSD"
              aria-label="下载原始 PSD"
              className={`rounded p-1.5 text-soft hover:bg-hover hover:text-main ${originalUrl ? '' : 'pointer-events-none opacity-35'}`}
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
