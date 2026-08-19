import { getCompositeImageData, initializeCanvas, readPsd } from 'ag-psd'

const MAX_DOCUMENT_SIDE = 12_000
const MAX_DOCUMENT_PIXELS = 40_000_000
const MAX_PREVIEW_SIDE = 2_400
const MAX_DECODE_MEMORY = 256 * 1024 * 1024

initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => new ImageData(width, height),
)

interface PreviewRequest {
  id: number
  buffer: ArrayBuffer
}

interface PreviewResponse {
  id: number
  blob?: Blob
  error?: string
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null
  postMessage: (message: PreviewResponse) => void
}

workerScope.onmessage = (event) => {
  const { id, buffer } = event.data
  void createPreview(buffer)
    .then((blob) => workerScope.postMessage({ id, blob }))
    .catch((error: unknown) => {
      workerScope.postMessage({
        id,
        error: error instanceof Error ? error.message : 'PSD preview failed',
      })
    })
}

async function createPreview(buffer: ArrayBuffer): Promise<Blob> {
  const psd = readPsd(buffer, {
    useRawData: true,
    useRawThumbnail: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    totalMemoryLimit: MAX_DECODE_MEMORY,
  })
  const { width, height } = psd
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_DOCUMENT_SIDE ||
    height > MAX_DOCUMENT_SIDE ||
    width * height > MAX_DOCUMENT_PIXELS
  ) {
    throw new Error('PSD dimensions exceed preview limits')
  }
  if ((psd.bitsPerChannel ?? 8) > 8) throw new Error('Only 8-bit PSD previews are supported')

  const pixels = getCompositeImageData(psd)
  if (!pixels) throw new Error('PSD has no composite image')

  const source = new OffscreenCanvas(width, height)
  const sourceContext = source.getContext('2d')
  if (!sourceContext) throw new Error('Canvas is unavailable')
  const rgba = new Uint8ClampedArray(pixels.data)
  sourceContext.putImageData(new ImageData(rgba, width, height), 0, 0)

  const scale = Math.min(1, MAX_PREVIEW_SIDE / Math.max(width, height))
  const previewWidth = Math.max(1, Math.round(width * scale))
  const previewHeight = Math.max(1, Math.round(height * scale))
  const preview = new OffscreenCanvas(previewWidth, previewHeight)
  const previewContext = preview.getContext('2d')
  if (!previewContext) throw new Error('Canvas is unavailable')
  previewContext.fillStyle = '#ffffff'
  previewContext.fillRect(0, 0, previewWidth, previewHeight)
  previewContext.drawImage(source, 0, 0, previewWidth, previewHeight)
  return preview.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}
