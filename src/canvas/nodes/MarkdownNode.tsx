import { memo, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import type { SuqNode } from '../../types'
import { useAssetUrl } from '../../media/useAssetUrl'
import { toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'

export const MarkdownNode = memo(function MarkdownNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const [content, setContent] = useState<string>()

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
    <MediaNodeShell node={props}>
      <div className="sq-markdown max-h-96 overflow-y-auto p-3 pr-4">
        {content !== undefined ? (
          <ReactMarkdown>{content}</ReactMarkdown>
        ) : (
          <div className="h-16 animate-pulse rounded bg-hover/60" />
        )}
      </div>
    </MediaNodeShell>
  )
})
