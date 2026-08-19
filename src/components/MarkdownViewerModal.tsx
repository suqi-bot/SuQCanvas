import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { DownloadIcon } from '../canvas/nodes/Icons'
import { useAssetUrl } from '../media/useAssetUrl'
import { invalidateAssetUrl } from '../media/blobRegistry'
import { updateAssetText } from '../io/fileLoader'
import { clearLanEditing, setLanEditing } from '../sync/lanClient'
import { useUiStore, toast } from '../store/uiStore'
import { useCanvasStore } from '../store/canvasStore'

export function MarkdownViewerModal() {
  const viewer = useUiStore((s) => s.markdownViewer)
  const close = useUiStore((s) => s.closeMarkdownViewer)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const [assetVersion, setAssetVersion] = useState(0)
  const url = useAssetUrl(viewer?.assetId, assetVersion)
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!viewer || !url) return
    let alive = true
    fetch(url)
      .then((response) => response.text())
      .then((text) => {
        if (alive) setContent(text.slice(0, 200_000))
      })
      .catch(() => toast('Markdown 加载失败', 'error'))
    return () => {
      alive = false
    }
  }, [viewer, url])

  useEffect(() => {
    if (!viewer?.nodeId) return
    setLanEditing(viewer.nodeId, viewer.name)
    return () => clearLanEditing()
  }, [viewer])

  if (!viewer) return null

  const save = async () => {
    setSaving(true)
    try {
      await updateAssetText(viewer.assetId, content)
      invalidateAssetUrl(viewer.assetId)
      setAssetVersion((version) => version + 1)
      if (viewer.nodeId) updateNodeData(viewer.nodeId, { assetUpdatedAt: Date.now() })
      setEditing(false)
      toast('Markdown 已保存', 'success')
    } catch (error) {
      console.error(error)
      toast('Markdown 保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[var(--overlay)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-soft">{viewer.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={url}
            download={viewer.name}
            title="下载 Markdown"
            className={`rounded-md p-1.5 text-soft hover:bg-hover hover:text-main ${url ? '' : 'pointer-events-none opacity-35'}`}
          >
            <DownloadIcon />
          </a>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-soft hover:bg-hover hover:text-main disabled:opacity-40"
            disabled={saving}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? '预览' : '编辑'}
          </button>
          {editing && (
            <button
              type="button"
              className="rounded-md bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? '保存中' : '保存'}
            </button>
          )}
          <button type="button" className="ml-1 rounded-md px-2 py-1 text-sm text-mid hover:bg-hover" onClick={close}>
            关闭
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto min-h-full max-w-5xl rounded-lg border border-edge bg-panel p-5 shadow-xl">
          {editing ? (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, 200_000))}
              className="h-[calc(100vh-150px)] min-h-96 w-full resize-none bg-transparent font-mono text-sm leading-6 text-main outline-none"
              spellCheck={false}
              autoFocus
            />
          ) : (
            <article className="sq-markdown">
              <ReactMarkdown>{content || '正在加载…'}</ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
