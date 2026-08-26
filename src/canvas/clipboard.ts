import type { SuqNode } from '../types'
import { db } from '../db/db'
import { getAssetBlob } from '../media/blobRegistry'
import { ensurePsdPreview } from '../media/psdPreview'

const TEXT_KINDS = new Set(['text', 'heading', 'sticky', 'shape'])

export function selectionTextLines(nodes: SuqNode[]): string[] {
  return nodes
    .map((n) => {
      const raw = TEXT_KINDS.has(n.data.kind) ? n.data.text : n.data.label
      return raw?.trim() || ''
    })
    .filter(Boolean)
}

export function selectionHtml(nodes: SuqNode[]): string {
  const lines = selectionTextLines(nodes)
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return lines.map((line) => `<div>${esc(line)}</div>`).join('')
}

export function isImageNode(node: SuqNode): boolean {
  return node.data.kind === 'image' || node.data.kind === 'psd'
}

export async function getPsdPreviewBlob(assetId: string): Promise<Blob | undefined> {
  const record = await db.assets.get(assetId)
  return record?.thumbnail instanceof Blob ? record.thumbnail : undefined
}

export async function imageNodeBlob(node: SuqNode): Promise<Blob> {
  if (!node.data.assetId) throw new Error('缺少素材引用')
  if (node.data.kind === 'psd') {
    const preview = await getPsdPreviewBlob(node.data.assetId)
    if (preview) return preview
    await ensurePsdPreview(node.data.assetId)
    const next = await getPsdPreviewBlob(node.data.assetId)
    if (next) return next
    throw new Error('PSD 预览生成失败')
  }
  return getAssetBlob(node.data.assetId)
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = url
    })
    const maxSide = 4096
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('图片编码失败')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

function legacyCopyText(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.setAttribute('readonly', '')
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

async function copyTextToSystem(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopyText(text)
  }
}

async function copyImageToSystem(png: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

export interface SystemCopyResult {
  image?: boolean
  text?: boolean
}

/** 把选中元素写入系统剪贴板：单个图片/PSD 复制图片本身，其余复制文字内容 */
export async function writeSelectionToSystemClipboard(
  nodes: SuqNode[],
): Promise<SystemCopyResult | null> {
  if (nodes.length === 0) return null
  if (nodes.length === 1 && isImageNode(nodes[0])) {
    try {
      const png = await blobToPng(await imageNodeBlob(nodes[0]))
      if (await copyImageToSystem(png)) return { image: true }
    } catch {
      // 图片复制失败时退回文字复制
    }
  }
  const lines = selectionTextLines(nodes)
  if (lines.length === 0) return null
  const ok = await copyTextToSystem(lines.join('\n'))
  return ok ? { text: true } : null
}
