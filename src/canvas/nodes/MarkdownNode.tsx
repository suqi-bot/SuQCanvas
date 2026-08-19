import { memo, useEffect, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import type { SuqNode } from '../../types'
import { useAssetUrl } from '../../media/useAssetUrl'
import { useUiStore, toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { DownloadIcon, OpenIcon } from './Icons'
import { useLanStore } from '../../store/lanStore'
import { clearLanEditing, setLanEditing } from '../../sync/lanClient'

export const MarkdownNode = memo(function MarkdownNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId, props.data.assetUpdatedAt)
  const openViewer = useUiStore((s) => s.openMarkdownViewer)
  const selfId = useLanStore((s) => s.selfId)
  const lock = useLanStore((s) => Object.values(s.editing).find((item) => item.nodeId === props.id && item.userId !== s.selfId))
  const [content, setContent] = useState<string>()
  const name = props.data.label ?? 'Markdown'

  const open = () => {
    if (lock) {
      toast(`${lock.name} 正在操作此元素`, 'info')
      return
    }
    if (!props.data.assetId) return
    openViewer(props.data.assetId, name, props.id)
  }

  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        if (alive) setContent(text.slice(0, 200_000))
      })
      .catch(() => {
        if (alive) toast('Markdown 加载失败', 'error')
      })
    return () => {
      alive = false
    }
  }, [url])

  return (
    <>
      <NodeResizer
        isVisible={props.selected && !lock}
        minWidth={180}
        minHeight={100}
        onResizeStart={() => setLanEditing(props.id, name)}
        onResizeEnd={() => clearLanEditing()}
        lineClassName="!border-sky-400"
        handleClassName="!h-2.5 !w-2.5 !border-sky-300 !bg-sky-600"
      />
      <MediaNodeShell node={props}>
      <div
        className="relative h-full min-h-0"
        onDoubleClick={(event) => {
          event.stopPropagation()
          open()
        }}
      >
        <div className="sq-markdown h-full overflow-y-auto p-3 pr-4">
        {content !== undefined ? (
          <ReactMarkdown>{content}</ReactMarkdown>
        ) : (
          <div className="h-16 animate-pulse rounded bg-hover/60" />
        )}
        </div>
        <div className="nodrag absolute right-2 top-2 flex gap-1 rounded-md border border-edge bg-panel/90 p-1 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title="查看 Markdown"
            aria-label="查看 Markdown"
            className="rounded p-1.5 text-soft hover:bg-hover hover:text-main"
            onClick={(event) => {
              event.stopPropagation()
              open()
            }}
          >
            <OpenIcon />
          </button>
          <a
            href={url}
            download={name}
            title="下载 Markdown"
            aria-label="下载 Markdown"
            className={`rounded p-1.5 text-soft hover:bg-hover hover:text-main ${url ? '' : 'pointer-events-none opacity-35'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <DownloadIcon />
          </a>
        </div>
        {lock && lock.userId !== selfId && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/10">
            <span className="rounded bg-panel/90 px-2 py-1 text-xs text-soft shadow">{lock.name} 正在操作</span>
          </div>
        )}
      </div>
      </MediaNodeShell>
    </>
  )
})
