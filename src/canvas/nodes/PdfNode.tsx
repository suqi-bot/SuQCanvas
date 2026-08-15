import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { SuqNode } from '../../types'
import type { PdfHandle } from '../../media/pdf'
import { useAssetUrl } from '../../media/useAssetUrl'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'

export const PdfNode = memo(function PdfNode(props: NodeProps<SuqNode>) {
  const { id, data } = props
  const url = useAssetUrl(data.assetId)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const openPdfViewer = useUiStore((s) => s.openPdfViewer)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!url) return
    let cancelled = false
    let handle: PdfHandle | null = null
    let page: PDFPageProxy | null = null
    let pdfMod: typeof import('../../media/pdf') | null = null
    setState('loading')

    void (async () => {
      try {
        pdfMod = await import('../../media/pdf')
        const h = await pdfMod.openPdf(url)
        if (cancelled) {
          pdfMod.closePdf(h)
          return
        }
        handle = h
        if (h.doc.numPages !== data.pageCount) {
          updateNodeData(id, { pageCount: h.doc.numPages })
        }
        page = await h.doc.getPage(1)
        const canvas = canvasRef.current
        if (cancelled || !canvas) {
          page.cleanup()
          if (cancelled) pdfMod.closePdf(h)
          return
        }
        const base = page.getViewport({ scale: 1 })
        await pdfMod.renderPageToCanvas(page, canvas, 264 / base.width)
        if (!cancelled) setState('ready')
        page.cleanup()
      } catch (err) {
        console.error('PDF 渲染失败', err)
        if (!cancelled) setState('error')
      }
    })()

    return () => {
      cancelled = true
      page?.cleanup()
      if (pdfMod) pdfMod.closePdf(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return (
    <MediaNodeShell node={props}>
      <div className="relative flex h-full w-full items-center justify-center bg-[var(--well)]">
        <canvas
          ref={canvasRef}
          className={`max-h-full max-w-full ${state === 'ready' ? '' : 'hidden'}`}
        />
        {state === 'loading' && (
          <div className="h-20 w-20 animate-pulse rounded bg-hover/60" />
        )}
        {state === 'error' && (
          <div className="p-4 text-center text-xs text-mid">PDF 加载失败</div>
        )}
        {state === 'ready' && (
          <button
            type="button"
            className="nodrag absolute inset-x-0 bottom-1 mx-auto w-fit rounded-md bg-[var(--nodebar)] px-2.5 py-1 text-xs text-[var(--accenttext)] opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
            onClick={() => openPdfViewer(data.assetId ?? '', data.label ?? 'PDF')}
          >
            查看全部 {data.pageCount ? `(${data.pageCount} 页)` : ''}
          </button>
        )}
      </div>
    </MediaNodeShell>
  )
})
