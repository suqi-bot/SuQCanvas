import { db } from '../db/db'
import { getAssetUrl, invalidateThumbnailUrl } from './blobRegistry'

interface PreviewResponse {
  id: number
  blob?: Blob
  error?: string
}

let worker: Worker | undefined
let requestId = 0
let queue = Promise.resolve()
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./psdPreview.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.blob) request.resolve(event.data.blob)
    else request.reject(new Error(event.data.error ?? 'PSD preview failed'))
  }
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error('PSD preview worker failed'))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

function requestPreview(buffer: ArrayBuffer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, buffer }, [buffer])
  })
}

export function generatePsdPreview(blob: Blob): Promise<Blob> {
  const task = async () => requestPreview(await blob.arrayBuffer())
  const result = queue.then(task, task)
  queue = result.then(() => undefined, () => undefined)
  return result
}

export async function ensurePsdPreview(assetId: string): Promise<void> {
  let record = await db.assets.get(assetId)
  if (!record) {
    await getAssetUrl(assetId)
    record = await db.assets.get(assetId)
  }
  if (!record) throw new Error('PSD asset is unavailable')
  if (record.thumbnail) return
  const thumbnail = await generatePsdPreview(record.blob)
  await db.assets.put({ ...record, thumbnail })
  invalidateThumbnailUrl(assetId)
}

