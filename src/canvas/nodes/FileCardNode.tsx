import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { formatBytes } from '../../media/fileKind'
import { MediaNodeShell } from './MediaNodeShell'
import { DownloadIcon, FileIcon, OpenIcon } from './Icons'
import { useAssetUrl } from '../../media/useAssetUrl'
import { toast } from '../../store/uiStore'

export const FileCardNode = memo(function FileCardNode(props: NodeProps<SuqNode>) {
  const { data } = props
  const url = useAssetUrl(data.assetId)
  const filename = data.label ?? '未命名文件'

  const openFile = () => {
    if (!url) {
      toast('文件仍在加载，请稍后重试', 'info')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <MediaNodeShell node={props}>
      <div
        className="flex h-full w-full items-center gap-3 p-3"
        onDoubleClick={(event) => {
          event.stopPropagation()
          openFile()
        }}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-hover text-mid">
          <FileIcon className="text-2xl" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 break-all text-sm leading-snug text-soft" title={data.label}>
            {filename}
          </div>
          <div className="mt-1 text-xs text-dim">
            {data.fileSize ? formatBytes(data.fileSize) : ''}
          </div>
        </div>
        <div className="nodrag flex shrink-0 flex-col gap-1">
          <button
            type="button"
            title="打开文件"
            aria-label="打开文件"
            disabled={!url}
            onClick={(event) => {
              event.stopPropagation()
              openFile()
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="rounded-md p-1.5 text-soft transition-colors hover:bg-hover hover:text-main disabled:cursor-wait disabled:opacity-35"
          >
            <OpenIcon />
          </button>
          <a
            href={url}
            download={filename}
            title="下载文件"
            aria-label="下载文件"
            onClick={(event) => {
              event.stopPropagation()
              if (!url) {
                event.preventDefault()
                toast('文件仍在加载，请稍后重试', 'info')
              }
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className={`rounded-md p-1.5 text-soft transition-colors hover:bg-hover hover:text-main ${url ? '' : 'cursor-wait opacity-35'}`}
          >
            <DownloadIcon />
          </a>
        </div>
      </div>
    </MediaNodeShell>
  )
})
