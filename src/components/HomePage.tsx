import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, gcAssets } from '../db/db'
import type { ProjectRecord } from '../db/db'
import { useProjectStore } from '../store/projectStore'
import { useUiStore, toast } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { usePlayerStore } from '../store/playerStore'
import { exportProjectToBlob, downloadBlob, importProjectFile } from '../io/importExport'
import { useCanvasStore } from '../store/canvasStore'
import { deleteProjectFromCloud, syncProjectList } from '../sync/cloudSync'
import { isCloudConfigured } from '../sync/supabaseClient'
import { isOssConfigured } from '../sync/ossClient'
import { IS_ONLINE_BUILD } from '../buildMode'
import { useAuthStore } from '../store/authStore'
import { useLanStore } from '../store/lanStore'
import {
  broadcastLocalProjects,
  deleteProjectFromLan,
  fetchLanBackups,
  fetchProjectFromLan,
  lanDisconnect,
  leaveLanProject,
  restoreProjectFromLan,
  type LanBackupMeta,
} from '../sync/lanClient'
import { STICKY_COLORS, type StickyColor, type SuqEdge, type SuqNode } from '../types'
import type { Theme } from '../store/settingsStore'
import { LanIcon, MoonIcon, PlusIcon, SunIcon } from '../canvas/nodes/Icons'
import { getDeviceId } from '../utils/deviceId'
import { APP_VERSION } from '../appVersion'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

function truncateTo(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${size} B`
}

interface TextOpts {
  fontSize: number
  color: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  alignV?: 'top' | 'middle' | 'bottom'
  pad?: number
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  o: TextOpts,
): void {
  if (!text) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : ''}${o.fontSize}px system-ui, sans-serif`
  ctx.fillStyle = o.color
  ctx.textBaseline = 'middle'
  const pad = o.pad ?? 4
  const lineH = o.fontSize * 1.5
  const lines = text.split('\n')
  const totalH = lines.length * lineH
  let y0 = y + pad
  if (o.alignV === 'middle') y0 = y + (h - totalH) / 2
  else if (o.alignV === 'bottom') y0 = y + h - totalH - pad
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cy = y0 + i * lineH + lineH / 2
    const lw = ctx.measureText(line).width
    let lx = x + pad
    if (o.align === 'center') lx = x + (w - lw) / 2
    else if (o.align === 'right') lx = x + w - lw - pad
    ctx.fillText(line, lx, cy)
    if (o.underline) {
      ctx.fillRect(lx, cy + o.fontSize * 0.55, lw, Math.max(0.5, o.fontSize * 0.08))
    }
  }
  ctx.restore()
}

const HEADING_FONT: Record<number, number> = { 1: 22, 2: 18, 3: 16 }

interface ThumbPalette {
  textBg: string
  textColor: string
  cardBg: string
  cardLabel: string
  cardSub: string
  mediaBg: string
  mediaText: string
  emptyText: string
  edgeColor: string
}

const THUMB_PALETTES: Record<Theme, ThumbPalette> = {
  dark: {
    textBg: 'rgba(148, 163, 184, 0.12)',
    textColor: '#e2e8f0',
    cardBg: 'rgba(100, 116, 139, 0.18)',
    cardLabel: '#e2e8f0',
    cardSub: 'rgba(148, 163, 184, 0.9)',
    mediaBg: 'rgba(30, 41, 59, 0.6)',
    mediaText: 'rgba(148, 163, 184, 0.9)',
    emptyText: 'rgba(148, 163, 184, 0.45)',
    edgeColor: 'rgba(148, 163, 184, 0.5)',
  },
  light: {
    textBg: 'rgba(100, 116, 139, 0.08)',
    textColor: '#1e293b',
    cardBg: 'rgba(100, 116, 139, 0.1)',
    cardLabel: '#334155',
    cardSub: 'rgba(100, 116, 139, 0.8)',
    mediaBg: 'rgba(226, 232, 240, 0.8)',
    mediaText: 'rgba(100, 116, 139, 0.9)',
    emptyText: 'rgba(100, 116, 139, 0.45)',
    edgeColor: 'rgba(100, 116, 139, 0.5)',
  },
}

function drawNodePreview(
  ctx: CanvasRenderingContext2D,
  n: SuqNode,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  p: ThumbPalette,
): void {
  const d = n.data ?? {}
  const kind = d.kind ?? 'file'
  const border = d.borderColor ?? '#64748b'
  const fs = (px: number) => Math.max(4, px * scale)
  const lw = Math.max(0.5, scale)

  if (kind === 'image' || kind === 'video') {
    ctx.fillStyle = p.mediaBg
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    drawTextBlock(ctx, kind === 'image' ? '图片' : '视频', x, y, w, h, {
      fontSize: fs(11),
      color: p.mediaText,
      align: 'center',
      alignV: 'middle',
    })
    return
  }

  if (kind === 'sticky') {
    const c = STICKY_COLORS[(d.color as StickyColor | undefined) ?? 'yellow']
    ctx.fillStyle = c.bg
    ctx.strokeStyle = c.border
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    ctx.stroke()
    drawTextBlock(ctx, d.text ?? '', x, y, w, h, {
      fontSize: fs(d.fontSize ?? 14),
      color: '#1e293b',
      bold: d.bold,
      italic: d.italic,
      align: d.textAlign,
      alignV: d.textAlignV,
    })
    return
  }

  if (kind === 'shape') {
    ctx.fillStyle = d.fill ?? '#38bdf8'
    ctx.strokeStyle = border
    ctx.lineWidth = lw
    ctx.beginPath()
    if ((d.shape ?? 'rect') === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    } else {
      ctx.roundRect(x, y, w, h, 2)
    }
    ctx.fill()
    ctx.stroke()
    drawTextBlock(ctx, d.text ?? '', x, y, w, h, {
      fontSize: fs(d.fontSize ?? 14),
      color: '#0f172a',
      align: 'center',
      alignV: 'middle',
    })
    return
  }

  if (kind === 'heading') {
    ctx.fillStyle = 'rgba(251, 191, 36, 0.12)'
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    ctx.stroke()
    const lv = (d.level as number | undefined) ?? 1
    drawTextBlock(ctx, d.text ?? '', x, y, w, h, {
      fontSize: fs(HEADING_FONT[lv] ?? 18),
      color: '#fbbf24',
      bold: true,
      alignV: 'middle',
    })
    return
  }

  if (kind === 'text' || kind === 'markdown') {
    ctx.fillStyle = p.textBg
    ctx.strokeStyle = border
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    ctx.stroke()
    drawTextBlock(ctx, d.text ?? '', x, y, w, h, {
      fontSize: fs(d.fontSize ?? 14),
      color: d.textColor ?? p.textColor,
      bold: d.bold,
      italic: d.italic,
      align: d.textAlign,
      alignV: d.textAlignV,
    })
    return
  }

  ctx.fillStyle = p.cardBg
  ctx.strokeStyle = border
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 2)
  ctx.fill()
  ctx.stroke()
  const label = d.label ?? ''
  let sub = ''
  if (kind === 'pdf' && typeof d.pageCount === 'number') sub = `${d.pageCount} 页`
  else if (typeof d.fileSize === 'number') sub = formatBytes(d.fileSize)
  ctx.textBaseline = 'middle'
  const lx = x + 5
  const midY = y + h / 2
  ctx.fillStyle = p.cardLabel
  ctx.font = `${fs(11)}px system-ui, sans-serif`
  ctx.fillText(truncateTo(ctx, label, w - 10), lx, sub ? midY - fs(6) : midY)
  if (sub) {
    ctx.fillStyle = p.cardSub
    ctx.font = `${fs(9)}px system-ui, sans-serif`
    ctx.fillText(sub, lx, midY + fs(7))
  }
}

function ProjectThumb({
  nodes,
  edges,
  theme,
}: {
  nodes: SuqNode[]
  edges: SuqEdge[]
  theme: Theme
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let alive = true
    const W = canvas.width
    const H = canvas.height
    const palette = THUMB_PALETTES[theme]

    void (async () => {
      ctx.clearRect(0, 0, W, H)
      if (nodes.length === 0) {
        ctx.fillStyle = palette.emptyText
        ctx.font = '13px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('空项目', W / 2, H / 2)
        return
      }
      const sizeOf = (n: SuqNode) => ({
        w: (n.width as number | undefined) ?? (n.style?.width as number | undefined) ?? 240,
        h: (n.height as number | undefined) ?? (n.style?.height as number | undefined) ?? 160,
      })
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const sizes = new Map<string, { w: number; h: number }>()
      for (const n of nodes) {
        const s = sizeOf(n)
        sizes.set(n.id, s)
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + s.w)
        maxY = Math.max(maxY, n.position.y + s.h)
      }
      const pad = 14
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const scale = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)
      const tx = (x: number) => pad + (x - minX) * scale
      const ty = (y: number) => pad + (y - minY) * scale

      for (const e of edges) {
        const s = nodes.find((n) => n.id === e.source)
        const t = nodes.find((n) => n.id === e.target)
        if (!s || !t) continue
        const ss = sizes.get(s.id) ?? { w: 240, h: 160 }
        const ts = sizes.get(t.id) ?? { w: 240, h: 160 }
        ctx.strokeStyle = e.data?.style?.stroke ?? palette.edgeColor
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(tx(s.position.x + ss.w / 2), ty(s.position.y + ss.h / 2))
        ctx.lineTo(tx(t.position.x + ts.w / 2), ty(t.position.y + ts.h / 2))
        ctx.stroke()
      }

      for (const n of nodes) {
        const s = sizes.get(n.id) ?? { w: 240, h: 160 }
        drawNodePreview(
          ctx,
          n,
          tx(n.position.x),
          ty(n.position.y),
          Math.max(2, s.w * scale),
          Math.max(2, s.h * scale),
          scale,
          palette,
        )
      }

      const media = nodes.filter(
        (n) => (n.data?.kind === 'image' || n.data?.kind === 'video') && n.data?.assetId,
      )
      if (media.length > 0) {
        const loaded = await Promise.all(
          media.map(async (n) => {
            try {
              const rec = await db.assets.get(n.data.assetId as string)
              const blob = rec?.kind === 'image' ? rec.blob : rec?.thumbnail
              const img = blob ? await loadImageFromBlob(blob) : null
              return { n, img }
            } catch {
              return { n, img: null }
            }
          }),
        )
        if (!alive) return
        for (const { n, img } of loaded) {
          if (!img) continue
          const s = sizes.get(n.id) ?? { w: 240, h: 160 }
          const x = tx(n.position.x)
          const y = ty(n.position.y)
          const w = Math.max(2, s.w * scale)
          const h = Math.max(2, s.h * scale)
          const inset = Math.max(1.5, 6 * scale)
          const ratio = Math.min((w - inset * 2) / img.naturalWidth, (h - inset * 2) / img.naturalHeight)
          const dw = Math.max(1, img.naturalWidth * ratio)
          const dh = Math.max(1, img.naturalHeight * ratio)
          ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [nodes, edges, theme])

  return <canvas ref={ref} width={320} height={176} className="h-full w-full" />
}

export function HomePage() {
  const open = useUiStore((s) => s.homeOpen)
  const setOpen = useUiStore((s) => s.setHomeOpen)
  const currentId = useProjectStore((s) => s.projectId)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)
  const busy = useProjectStore((s) => s.busy)
  const setBusy = useProjectStore((s) => s.setBusy)
  const renameProject = useProjectStore((s) => s.renameProject)
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const initialized = useProjectStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const guest = useAuthStore((s) => s.guest)
  const signOut = useAuthStore((s) => s.signOut)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const importRef = useRef<HTMLInputElement | null>(null)
  const remoteProjects = useLanStore((s) => s.remoteProjects)
  const lanName = useLanStore((s) => s.name)
  const [backups, setBackups] = useState<LanBackupMeta[] | null>(null)

  const refresh = useCallback(async () => {
    setProjects(await syncProjectList())
  }, [])

  useEffect(() => {
    if (open && initialized) void refresh()
  }, [open, initialized, refresh, remoteProjects])

  useEffect(() => {
    if (open) usePlayerStore.getState().stop()
  }, [open])

  const remoteIdSet = useMemo(() => new Set(remoteProjects.map((r) => r.id)), [remoteProjects])

  const isSharedId = (id: string) => remoteIdSet.has(id)
  const isRemoteOnlyId = (id: string) =>
    isSharedId(id) && !projects.some((project) => project.id === id)

  /** 展示列表 = 本地项目 + 局域网远端项目（本地没有的） */
  const visibleProjects = useMemo(() => {
    const merged = [...projects]
    for (const r of remoteProjects) {
      const localIndex = merged.findIndex((project) => project.id === r.id)
      if (localIndex < 0) {
        merged.push({
          id: r.id,
          name: r.name,
          createdAt: 0,
          updatedAt: r.updatedAt,
          graph: { nodes: [], edges: [] },
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      } else if (r.updatedAt > merged[localIndex].updatedAt) {
        merged[localIndex] = {
          ...merged[localIndex],
          name: r.name,
          updatedAt: r.updatedAt,
        }
      }
    }
    return merged.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projects, remoteProjects])

  if (!open) return null

  const handleNew = async () => {
    await newProject('未命名项目')
    setOpen(false)
  }

  const handleReturnToLanLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      await useProjectStore.getState().saveNow()
      lanDisconnect()
      await signOut()
    } finally {
      setBusy(false)
    }
  }

  const handleOpen = async (p: ProjectRecord) => {
    let fetchedShared = false
    if (isSharedId(p.id)) {
      const rec = await fetchProjectFromLan(p.id)
      if (!rec) {
        toast('无法从局域网获取该项目，设备可能已离线', 'error')
        return
      }
      await db.projects.put(rec)
      fetchedShared = true
      await refresh()
    }
    if (fetchedShared || p.id !== currentId) {
      await loadProject(p.id)
    }
    setOpen(false)
  }

  const handleDelete = async (p: ProjectRecord) => {
    if (isSharedId(p.id)) {
      const meta = remoteProjects.find((r) => r.id === p.id)
      if (meta?.creatorId && meta.creatorId !== getDeviceId()) {
        toast('只有项目创建者（主机）可以删除项目', 'error')
        return
      }
    }
    if (!window.confirm(`确定删除项目「${p.name}」吗？删除后服务器将保留备份 24 小时。`)) return
    setBusy(true)
    try {
      const authed = useAuthStore.getState().user !== null
      if (authed) {
        await deleteProjectFromCloud(p.id)
      } else {
        await db.projects.delete(p.id)
      }
      if (isSharedId(p.id)) deleteProjectFromLan(p.id)
      if (!authed) await gcAssets()
      if (currentId === p.id) {
        const remaining = (await syncProjectList())[0]
        if (remaining) {
          await loadProject(remaining.id)
        } else {
          useCanvasStore.getState().reset()
          useCanvasStore.getState().clearHistory()
          useProjectStore.setState({
            projectId: null,
            projectName: '未命名项目',
            loaded: false,
            saveStatus: 'idle',
          })
          leaveLanProject()
        }
      }
      await refresh()
    } catch (err) {
      console.error('删除项目失败', err)
      toast('删除项目失败', 'error')
    } finally {
      setBusy(false)
    }
    void broadcastLocalProjects()
  }

  const handleRestore = async (b: LanBackupMeta) => {
    if (busy) return
    if (b.creatorId && b.creatorId !== getDeviceId()) {
      toast('只有项目创建者可以恢复该项目', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await restoreProjectFromLan(b.projectId, b.deletedAt)
      if (!result.ok) {
        const messages: Record<string, string> = {
          exists: '已存在同名项目，无法恢复',
          denied: '只有项目创建者可以恢复该项目',
          expired: '备份已过期或已被清理',
          timeout: '请求超时，请重试',
          disconnected: '局域网未连接',
        }
        toast(messages[result.error ?? ''] ?? '恢复失败，请重试', 'error')
        if (result.error !== 'denied') setBackups(await fetchLanBackups())
        return
      }
      toast(`已恢复项目「${b.name}」`, 'success')
      void fetchProjectFromLan(b.projectId)
      setBackups((prev) =>
        prev?.filter((x) => !(x.projectId === b.projectId && x.deletedAt === b.deletedAt)) ?? prev,
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (p: ProjectRecord) => {
    try {
      let blob: Blob
      if (p.id === currentId) {
        const { nodes, edges, viewport } = useCanvasStore.getState()
        blob = await exportProjectToBlob(p.name, nodes, edges, viewport)
      } else {
        blob = await exportProjectToBlob(p.name, p.graph.nodes, p.graph.edges, p.viewport)
      }
      const safeName = p.name.replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(blob, `${safeName}.sqcanvas`)
      toast(`「${p.name}」已导出`, 'success')
    } catch (err) {
      console.error(err)
      toast('导出失败', 'error')
    }
  }

  const handleImport = async (file: File) => {
    try {
      await importProjectFile(file)
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast(err instanceof Error ? err.message : '导入失败', 'error')
    }
  }

  const commitRename = (p: ProjectRecord) => {
    void renameProject(p.id, renameValue.trim() || p.name)
    setRenaming(null)
    void refresh()
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-app text-main">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-8 py-6">
        <header className="flex shrink-0 items-center gap-3">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-lg font-bold tracking-wide">SuQCanvas</span>
            <span className="text-[11px] font-medium tabular-nums text-dim">{APP_VERSION}</span>
          </div>
          <span className="text-xs text-dim">无限画布 · 项目总览</span>
          {IS_ONLINE_BUILD ? (
            <>
              {isCloudConfigured() ? (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                  云同步已连接
                </span>
              ) : (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                  本地模式（未配置 Supabase）
                </span>
              )}
              {isOssConfigured() ? (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                  OSS 已连接
                </span>
              ) : (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                  OSS 未配置
                </span>
              )}
            </>
          ) : (
            <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400">
              局域网版
            </span>
          )}
          <div className="flex-1" />
          {user ? (
            <span
              className="max-w-48 truncate rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-400"
              title={user.email ?? ''}
            >
              {user.email}
            </span>
          ) : IS_ONLINE_BUILD ? (
            <span
              className="max-w-40 truncate rounded bg-violet-500/15 px-2 py-1 text-xs text-violet-400"
              title="当前为游客模式，数据仅保存在本设备"
            >
              游客模式
            </span>
          ) : (
            <span
              className="max-w-40 truncate rounded bg-violet-500/15 px-2 py-1 text-xs text-violet-400"
              title={`我的协作名称：${lanName || '未命名'}`}
            >
              {lanName || '局域网协作'}
            </span>
          )}
          {!IS_ONLINE_BUILD && (
            <button
              type="button"
              onClick={() => void handleReturnToLanLogin()}
              disabled={busy}
              title="断开连接并返回局域网登录"
              className="flex items-center gap-1.5 rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover disabled:cursor-wait disabled:opacity-50"
            >
              <LanIcon />
              局域网
            </button>
          )}
          {IS_ONLINE_BUILD && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
            >
              {guest ? '返回登录' : '退出登录'}
            </button>
          )}
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover disabled:cursor-wait disabled:opacity-50"
          >
            导入 .sqcanvas
          </button>
          {!IS_ONLINE_BUILD && (
            <button
              type="button"
              onClick={async () => {
                if (backups !== null) {
                  setBackups(null)
                } else {
                  setBackups(await fetchLanBackups())
                }
              }}
              disabled={busy}
              className={`rounded-md border px-3 py-1.5 text-xs hover:bg-hover disabled:cursor-wait disabled:opacity-50 ${
                backups !== null
                  ? 'border-sky-500/50 text-sky-500'
                  : 'border-edge2 text-soft'
              }`}
            >
              恢复已删除
            </button>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到白色主题' : '切换到深色主题'}
            className="rounded-md border border-edge2 p-1.5 text-mid hover:bg-hover hover:text-main"
          >
            {theme === 'dark' ? <SunIcon className="text-base" /> : <MoonIcon className="text-base" />}
          </button>
        </header>

        <div className="my-6">
          <button
            type="button"
            onClick={() => void handleNew()}
            disabled={busy}
            className="group flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-edge2 bg-panel px-6 py-5 transition-colors hover:border-sky-500/60 hover:bg-hover/40 disabled:cursor-wait disabled:opacity-60 disabled:hover:border-edge2 disabled:hover:bg-panel"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600/15 text-sky-500 transition-colors group-hover:bg-sky-600 group-hover:text-white">
              <PlusIcon className="text-lg" />
            </span>
            <div className="text-left">
              <div className="text-sm font-medium text-soft">新建项目</div>
              <div className="mt-0.5 text-xs text-dim">创建一个空白画布，开始自由创作</div>
            </div>
          </button>
        </div>

        {backups !== null && (
          <div className="mb-6 rounded-2xl border border-edge bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-dim">
                可恢复的项目（{backups.length}）· 备份保留 24 小时
              </span>
              <button
                type="button"
                onClick={() => setBackups(null)}
                className="rounded px-2 py-0.5 text-xs text-mid hover:bg-hover hover:text-main"
              >
                收起
              </button>
            </div>
            {backups.length === 0 ? (
              <div className="py-6 text-center text-sm text-dim">没有可恢复的已删除项目</div>
            ) : (
              <div className="flex flex-col gap-2">
                {backups.map((b) => {
                  const canRestore = !b.creatorId || b.creatorId === getDeviceId()
                  return (
                    <div
                      key={`${b.projectId}:${b.deletedAt}`}
                      className="flex items-center gap-3 rounded-xl border border-edge px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-soft">{b.name}</div>
                        <div className="mt-0.5 text-[11px] text-dim">
                          {b.nodeCount} 个元素 · 删除于 {fmtTime(b.deletedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRestore(b)}
                        disabled={busy || !canRestore}
                        title={canRestore ? '恢复该项目' : '仅创建者可恢复'}
                        className="shrink-0 rounded-md border border-sky-500/40 px-3 py-1 text-xs text-sky-500 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        恢复
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-dim">
          全部项目（{visibleProjects.length}）
        </div>

        {!initialized ? (
          <div className="rounded-2xl border border-edge bg-panel py-16 text-center text-sm text-dim">
            项目加载中…
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-2xl border border-edge bg-panel py-16 text-center text-sm text-dim">
            暂无项目，点击上方「新建项目」开始
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((p) => (
              <div
                key={p.id}
                className={`group flex flex-col overflow-hidden rounded-2xl border bg-panel transition-colors hover:border-sky-500/50 ${
                  p.id === currentId ? 'border-sky-600' : 'border-edge'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handleOpen(p)}
                  disabled={busy}
                  className="relative h-36 w-full cursor-pointer bg-panel2/50 p-1.5 disabled:cursor-wait"
                  title={`打开「${p.name}」`}
                >
                  <ProjectThumb nodes={p.graph.nodes} edges={p.graph.edges} theme={theme} />
                  {p.id === currentId && (
                    <span className="absolute right-2 top-2 rounded bg-sky-600/80 px-1.5 py-0.5 text-[10px] text-white">
                      当前
                    </span>
                  )}
                  {isSharedId(p.id) && (
                    <span className="absolute bottom-2 right-2 rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] text-white">
                      共享
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-2 px-3.5 py-2.5">
                  {renaming === p.id ? (
                    <input
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p)
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => commitRename(p)}
                      className="min-w-0 flex-1 rounded border border-sky-600 bg-panel2 px-2 py-1 text-xs text-main outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleOpen(p)}
                      disabled={busy}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-soft hover:text-sky-500 disabled:cursor-wait"
                      title={p.name}
                    >
                      {p.name}
                    </button>
                  )}
                  {!isRemoteOnlyId(p.id) && (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title="重命名"
                        onClick={() => {
                          setRenaming(p.id)
                          setRenameValue(p.name)
                        }}
                        className="rounded px-1.5 py-1 text-xs text-mid hover:bg-hover hover:text-main"
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        title="导出"
                        onClick={() => void handleExport(p)}
                        className="rounded px-1.5 py-1 text-xs text-mid hover:bg-hover hover:text-main"
                      >
                        导出
                      </button>
                      <button
                        type="button"
                        title={
                          isSharedId(p.id) &&
                          remoteProjects.find((r) => r.id === p.id)?.creatorId &&
                          remoteProjects.find((r) => r.id === p.id)?.creatorId !== getDeviceId()
                            ? '仅创建者可删除'
                            : '删除'
                        }
                        onClick={() => void handleDelete(p)}
                        disabled={
                          busy ||
                          (isSharedId(p.id) &&
                            !!remoteProjects.find((r) => r.id === p.id)?.creatorId &&
                            remoteProjects.find((r) => r.id === p.id)?.creatorId !== getDeviceId())
                        }
                        className="rounded px-1.5 py-1 text-xs text-rose-500 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 border-t border-edge px-3.5 py-1.5 text-[11px] text-dim">
                  <span>{p.graph.nodes.length} 个元素</span>
                  <span className="ml-auto tabular-nums">{fmtTime(p.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".sqcanvas,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImport(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
