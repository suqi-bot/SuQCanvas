import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useAssetUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore, toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { DownloadIcon, OpenIcon } from './Icons'
import { useLanStore } from '../../store/lanStore'
import { clearLanEditing, setLanEditing } from '../../sync/lanClient'
import { AiImageComposer } from '../../components/AiImageComposer'
import { useAiStore } from '../../ai/store'
import { useProjectStore } from '../../store/projectStore'
import { aiJobKey } from '../../ai/taskTypes'

const MAX_W = 480
const MAX_H = 360

export const ImageNode = memo(function ImageNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const openImageViewer = useUiStore((s) => s.openImageViewer)
  const aiNodeId = useUiStore((s) => s.aiNodeId)
  const projectId = useProjectStore((s) => s.projectId)
  const running = useAiStore((s) => !!s.jobs[aiJobKey(projectId, props.id)]?.running)
  const lock = useLanStore((s) =>
    Object.values(s.editing).find((item) => item.nodeId === props.id && item.userId !== s.selfId),
  )
  const fittedRef = useRef(false)
  // 图片加载完成的淡入状态:局域网分片传输期间占位层缓闪,内容到达后跨淡入
  const [loaded, setLoaded] = useState(false)
  const filename = props.data.label ?? '图片'

  useEffect(() => {
    setLoaded(false)
  }, [url])

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
        lineClassName="sq-image-resize-line"
        handleClassName="sq-image-resize-handle"
      />
      <MediaNodeShell node={props} floatingBar>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--well)] p-1.5"
        onClick={() => { if (props.data.ai && !lock) useUiStore.getState().openAiNode(props.id) }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          if (props.data.ai && !props.data.assetId) return
          openImage()
        }}
      >
          {props.data.ai && !url && <button type="button" className="nodrag relative z-10 flex h-full w-full flex-col items-center justify-center gap-3 rounded border border-dashed border-sky-500/50 p-4 text-sm text-soft"
            disabled={!!lock} onClick={() => useUiStore.getState().openAiNode(props.id)}>
            <span className="text-2xl text-sky-500">✦</span>
            <span>{running ? '正在后台生成…' : props.data.ai.status === 'error' ? '生成失败，点击重试' : 'AI 图片 · 点击输入生成需求'}</span>
            <span className="line-clamp-3 text-xs text-mid">{props.data.ai.draftPrompt ?? props.data.ai.prompt}</span>
          </button>}
          {/* 占位层:加载中脉动,图片到达后与图片交叉淡出 */}
          <div
            className={`${props.data.ai && !url ? 'hidden' : ''} absolute h-16 w-16 rounded bg-hover/60 transition-opacity duration-300 ${url ? (loaded ? 'opacity-0' : 'animate-pulse opacity-100') : 'animate-pulse opacity-100'}`}
          />
          {url && (
            <img
              src={url}
              alt={props.data.label ?? ''}
              draggable={false}
              onLoad={(e) => {
                setLoaded(true)
                handleLoad(e)
              }}
              className={`relative max-h-full max-w-full rounded object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
        {props.data.ai && url && <span className="pointer-events-none absolute left-2 top-2 rounded bg-panel/90 px-2 py-1 text-xs text-sky-500">{running ? '✦ 生成中…' : '✦ AI'}</span>}
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
      {props.data.ai && <AiImageComposer id={props.id} ai={props.data.ai} visible={aiNodeId === props.id && !!props.selected} locked={!!lock} />}
    </>
  )
})
