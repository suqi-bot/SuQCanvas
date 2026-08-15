import type { XYPosition } from '@xyflow/react'
import { db, requestPersistentStorage } from '../db/db'
import { detectKind } from '../media/fileKind'
import { genId, useCanvasStore } from '../store/canvasStore'
import type { AssetMeta, MediaKind, SuqNode } from '../types'
import { toast } from '../store/uiStore'

function captureVideoThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    const cleanup = () => URL.revokeObjectURL(url)
    const fail = () => {
      cleanup()
      reject(new Error('无法生成视频缩略图'))
    }

    video.onerror = fail
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, Math.max(0, (video.duration || 0) / 2))
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0)
        canvas.toBlob(
          (blob) => {
            cleanup()
            if (blob) resolve(blob)
            else fail()
          },
          'image/jpeg',
          0.75,
        )
      } catch {
        fail()
      }
    }
  })
}

export async function putAsset(file: File): Promise<AssetMeta> {
  const kind = detectKind(file)
  const id = genId('a')
  let thumbnail: Blob | undefined
  if (kind === 'video') {
    thumbnail = await captureVideoThumbnail(file).catch(() => undefined)
  }
  await db.assets.add({
    id,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind,
    blob: file,
    thumbnail,
  })
  return { id, name: file.name, mime: file.type, size: file.size, kind, hasThumbnail: !!thumbnail }
}

const KIND_TO_TYPE: Record<MediaKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  markdown: 'markdown',
  text: 'text',
  file: 'fileCard',
}

const PLACEHOLDER_SIZE: Record<MediaKind, { width?: number; height?: number }> = {
  image: { width: 240, height: 180 },
  video: { width: 480, height: 270 },
  audio: { width: 260 },
  pdf: { width: 300, height: 400 },
  markdown: { width: 340 },
  text: { width: 280 },
  file: { width: 240 },
}

export function createNodeForAsset(meta: AssetMeta, position: XYPosition): SuqNode {
  const size = PLACEHOLDER_SIZE[meta.kind]
  return {
    id: genId('n'),
    type: KIND_TO_TYPE[meta.kind],
    position,
    style: size.width ? { width: size.width, height: size.height } : undefined,
    data: {
      kind: meta.kind,
      assetId: meta.id,
      label: meta.name,
      fileSize: meta.size,
      mime: meta.mime,
      borderColor: '#64748b',
    },
  }
}

const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024

export async function importFiles(files: File[], position: XYPosition): Promise<void> {
  if (files.length === 0) return
  void requestPersistentStorage()
  let pos = { ...position }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      toast(`「${file.name}」超过 1.5GB，已跳过`, 'error')
      continue
    }
    try {
      const meta = await putAsset(file)
      const node = createNodeForAsset(meta, pos)
      useCanvasStore.getState().addNodes([node])
      pos = { x: pos.x + 36, y: pos.y + 36 }
    } catch (err) {
      console.error('导入失败:', file.name, err)
      toast(`导入「${file.name}」失败`, 'error')
    }
  }
}

export function createTextNode(position: XYPosition, autoEdit = false): SuqNode {
  return {
    id: genId('n'),
    type: 'text',
    position,
    style: { width: 240 },
    data: {
      kind: 'text',
      label: '文本',
      text: '',
      autoEdit,
      borderColor: '#64748b',
    },
  }
}
