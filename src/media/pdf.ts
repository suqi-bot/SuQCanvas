import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfHandle {
  task: PDFDocumentLoadingTask
  doc: PDFDocumentProxy
}

export async function openPdf(url: string): Promise<PdfHandle> {
  const task = pdfjs.getDocument({ url })
  const doc = await task.promise
  return { task, doc }
}

export function closePdf(handle: PdfHandle | null): void {
  if (handle && !handle.task.destroyed) {
    void handle.task.destroy()
  }
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const viewport = page.getViewport({ scale })
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  await page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise
}
