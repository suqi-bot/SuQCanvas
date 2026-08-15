import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { formatBytes } from '../../media/fileKind'
import { MediaNodeShell } from './MediaNodeShell'
import { FileIcon } from './Icons'

export const FileCardNode = memo(function FileCardNode(props: NodeProps<SuqNode>) {
  const { data } = props
  return (
    <MediaNodeShell node={props}>
      <div className="flex h-full w-full items-center gap-3 p-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-hover text-mid">
          <FileIcon className="text-2xl" />
        </div>
        <div className="min-w-0">
          <div className="line-clamp-2 break-all text-sm leading-snug text-soft" title={data.label}>
            {data.label ?? '未命名文件'}
          </div>
          <div className="mt-1 text-xs text-dim">
            {data.fileSize ? formatBytes(data.fileSize) : ''}
          </div>
        </div>
      </div>
    </MediaNodeShell>
  )
})
