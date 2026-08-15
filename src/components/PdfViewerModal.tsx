import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { useUiStore, toast } from '../store/uiStore'
import { useAssetUrl } from '../media/useAssetUrl'
import type { PdfHandle } from '../media/pdf'

export function PdfViewerModal() {
  const viewer = useUiStore((s) => s.pdfViewer)
  const close = useUiStore((s) => s.closePdfViewer)
  const url = useAssetUrl(viewer?.assetId)

  const [doc, setDoc] = useState<PdfHandle | null>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [current, setCurrent] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PdfHandle | null>(null)

  useEffect(() => {
    docRef.current = doc
  }, [doc])

  const loadDoc = useCallback(async (sourceUrl: string) => {
    setLoading(true)
    setDoc(null)
    setCurrent(1)
    try {
      const pdfMod = await import('../media/pdf')
      const handle = await pdfMod.openPdf(sourceUrl)
      setDoc(handle)
      setNumPages(handle.doc.numPages)
      setLoading(false)
    } catch (err) {
      console.error(err)
      toast('PDF 打开失败', 'error')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!viewer) return
    if (url) void loadDoc(url)
    return () => {
      page?.cleanup()
      const handle = docRef.current
      docRef.current = null
      if (handle) {
        void import('../media/pdf').then((m) => m.closePdf(handle))
      }
      setDoc(null)
      setPage(null)
      setNumPages(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, url])

  const renderCurrent = useCallback(
    async (pageNum: number) => {
      if (!doc) return
      page?.cleanup()
      setPage(null)
      try {
        const pdfMod = await import('../media/pdf')
        const p = await doc.doc.getPage(pageNum)
        setPage(p)
        const canvas = canvasRef.current
        if (!canvas) return
        const base = p.getViewport({ scale: 1 })
        const scale = Math.min(2, 900 / base.width)
        await pdfMod.renderPageToCanvas(p, canvas, scale)
      } catch (err) {
        console.error(err)
        toast('页面渲染失败', 'error')
      }
    },
    [doc, page],
  )

  useEffect(() => {
    if (doc) void renderCurrent(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, current])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!viewer) return
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') setCurrent((c) => Math.max(1, c - 1))
      if (e.key === 'ArrowRight') setCurrent((c) => Math.min(numPages || c, c + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, numPages, close])

  if (!viewer) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge bg-panel px-4">
        <span className="max-w-[40%] truncate text-sm text-soft">{viewer.name}</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-soft hover:bg-hover disabled:opacity-40"
            disabled={current <= 1 || !doc}
            onClick={() => setCurrent((c) => Math.max(1, c - 1))}
          >
            ← 上一页
          </button>
          <span className="text-xs tabular-nums text-dim">
            {current} / {numPages || '-'}
          </span>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-soft hover:bg-hover disabled:opacity-40"
            disabled={current >= numPages || !doc}
            onClick={() => setCurrent((c) => Math.min(numPages, c + 1))}
          >
            下一页 →
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-mid hover:bg-hover hover:text-main"
            onClick={close}
          >
            关闭 ✕
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6">
        {loading ? (
          <div className="mt-20 h-10 w-10 animate-pulse rounded-full bg-hover/60" />
        ) : (
          <canvas ref={canvasRef} className="max-w-full rounded-md bg-white shadow-2xl" />
        )}
      </div>
    </div>
  )
}
