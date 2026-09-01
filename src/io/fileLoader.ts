import type { XYPosition } from '@xyflow/react'
import { db, requestPersistentStorage } from '../db/db'
import { detectKind } from '../media/fileKind'
import { genId, useCanvasStore } from '../store/canvasStore'
import type {
  AssetMeta,
  HeadingLevel,
  MediaKind,
  ShapeType,
  StickyColor,
  SuqNode,
} from '../types'
import { toast } from '../store/uiStore'
import { useUploadStore } from '../store/uploadStore'
import { isLanConnected, pushAssetToLan } from '../sync/lanClient'
import { STICKY_COLORS } from '../types'
import { generatePsdPreview } from '../media/psdPreview'

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
  } else if (kind === 'psd') {
    thumbnail = await generatePsdPreview(file).catch((error) => {
      console.warn('PSD 预览生成失败:', file.name, error)
      toast(`「${file.name}」无法生成预览，仍可下载原文件`, 'error')
      return undefined
    })
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
  const meta: AssetMeta = {
    id,
    name: file.name,
    mime: file.type,
    size: file.size,
    kind,
    hasThumbnail: !!thumbnail,
  }
  if (isLanConnected()) {
    void pushAssetToLan(meta, file, thumbnail).catch(() => {
      toast(`「${file.name}」局域网分发失败`, 'error')
    })
  }
  // 云端上传带状态追踪：失败会在文件列表标出，可点击重新上传
  void useUploadStore.getState().runCloudUpload(id)
  return meta
}

/** 更新可编辑文本资源，并复用现有云端/局域网素材同步链路。 */
export async function updateAssetText(assetId: string, text: string): Promise<void> {
  const record = await db.assets.get(assetId)
  if (!record) throw new Error('素材不存在')
  const blob = new Blob([text], { type: record.mime || 'text/markdown' })
  await db.assets.put({ ...record, blob, size: blob.size })
  const meta: AssetMeta = {
    id: record.id,
    name: record.name,
    mime: record.mime,
    size: blob.size,
    kind: record.kind,
    hasThumbnail: Boolean(record.thumbnail),
  }
  if (isLanConnected()) void pushAssetToLan(meta, blob, record.thumbnail)
  void useUploadStore.getState().runCloudUpload(assetId)
}

const KIND_TO_TYPE: Record<MediaKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  psd: 'psd',
  markdown: 'markdown',
  text: 'text',
  file: 'fileCard',
  heading: 'heading',
  sticky: 'sticky',
  shape: 'shape',
}

const PLACEHOLDER_SIZE: Record<MediaKind, { width?: number; height?: number }> = {
  image: { width: 240, height: 180 },
  video: { width: 480, height: 270 },
  audio: { width: 260 },
  pdf: { width: 300, height: 400 },
  psd: { width: 320, height: 240 },
  markdown: { width: 340 },
  text: { width: 280 },
  file: { width: 240 },
  heading: { width: 360 },
  sticky: { width: 200, height: 160 },
  shape: { width: 180, height: 120 },
}

export function createNodeForAsset(meta: AssetMeta, position: XYPosition): SuqNode {
  const size = PLACEHOLDER_SIZE[meta.kind]
  return {
    id: genId('n'),
    type: KIND_TO_TYPE[meta.kind],
    position,
    width: size.width,
    height: size.height,
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
    width: 240,
    data: {
      kind: 'text',
      label: '文本',
      text: '',
      autoEdit,
      borderColor: '#64748b',
    },
  }
}

const HEADING_SIZE: Record<HeadingLevel, { width: number; height: number }> = {
  1: { width: 420, height: 64 },
  2: { width: 360, height: 56 },
  3: { width: 300, height: 48 },
}

export function createHeadingNode(
  position: XYPosition,
  level: HeadingLevel = 1,
  autoEdit = false,
): SuqNode {
  return {
    id: genId('n'),
    type: 'heading',
    position,
    width: HEADING_SIZE[level].width,
    height: HEADING_SIZE[level].height,
    data: {
      kind: 'heading',
      level,
      label: `标题 ${level}`,
      text: '',
      autoEdit,
      borderColor: '#64748b',
    },
  }
}

export function createStickyNode(
  position: XYPosition,
  color: StickyColor = 'yellow',
  autoEdit = false,
): SuqNode {
  return {
    id: genId('n'),
    type: 'sticky',
    position,
    width: 200,
    height: 160,
    data: {
      kind: 'sticky',
      color,
      label: '便签',
      text: '',
      autoEdit,
      borderColor: STICKY_COLORS[color].border,
    },
  }
}

export function createShapeNode(
  position: XYPosition,
  shape: ShapeType = 'rect',
  autoEdit = false,
): SuqNode {
  return {
    id: genId('n'),
    type: 'shape',
    position,
    width: 180,
    height: 120,
    data: {
      kind: 'shape',
      shape,
      label: shape === 'rect' ? '矩形' : '椭圆',
      text: '',
      autoEdit,
      fill: '#38bdf8',
      borderColor: '#0ea5e9',
      textAlign: 'center',
      textAlignV: 'middle',
    },
  }
}
