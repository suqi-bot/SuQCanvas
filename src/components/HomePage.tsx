import { useCallback, useEffect, useRef, useState } from 'react'
import { db, gcAssets } from '../db/db'
import type { ProjectRecord } from '../db/db'
import { useProjectStore } from '../store/projectStore'
import { useUiStore, toast } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { exportProjectToBlob, downloadBlob, importProjectFile } from '../io/importExport'
import { useCanvasStore } from '../store/canvasStore'
import { deleteProjectFromCloud, syncProjectList } from '../sync/cloudSync'
import { isCloudConfigured } from '../sync/supabaseClient'
import { isOssConfigured } from '../sync/ossClient'
import type { SuqEdge, SuqNode } from '../types'
import { MoonIcon, PlusIcon, SunIcon } from '../canvas/nodes/Icons'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const KIND_COLOR: Record<string, string> = {
  image: '#38bdf8',
  video: '#a78bfa',
  audio: '#34d399',
  pdf: '#f87171',
  markdown: '#94a3b8',
  text: '#64748b',
  file: '#64748b',
  heading: '#fbbf24',
  sticky: '#fde68a',
  shape: '#4ade80',
}

function ProjectThumb({ nodes, edges }: { nodes: SuqNode[]; edges: SuqEdge[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    if (nodes.length === 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)'
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

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
    ctx.lineWidth = 1
    for (const e of edges) {
      const s = nodes.find((n) => n.id === e.source)
      const t = nodes.find((n) => n.id === e.target)
      if (!s || !t) continue
      const ss = sizes.get(s.id) ?? { w: 240, h: 160 }
      const ts = sizes.get(t.id) ?? { w: 240, h: 160 }
      ctx.beginPath()
      ctx.moveTo(tx(s.position.x + ss.w / 2), ty(s.position.y + ss.h / 2))
      ctx.lineTo(tx(t.position.x + ts.w / 2), ty(t.position.y + ts.h / 2))
      ctx.stroke()
    }

    for (const n of nodes) {
      const s = sizes.get(n.id) ?? { w: 240, h: 160 }
      const x = tx(n.position.x)
      const y = ty(n.position.y)
      const w = Math.max(2, s.w * scale)
      const h = Math.max(2, s.h * scale)
      ctx.fillStyle = KIND_COLOR[n.data?.kind ?? 'file'] ?? '#64748b'
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 2)
      ctx.fill()
    }
  }, [nodes, edges])

  return <canvas ref={ref} width={320} height={176} className="h-full w-full" />
}

export function HomePage() {
  const open = useUiStore((s) => s.homeOpen)
  const setOpen = useUiStore((s) => s.setHomeOpen)
  const currentId = useProjectStore((s) => s.projectId)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)
  const renameProject = useProjectStore((s) => s.renameProject)
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const importRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setProjects(await syncProjectList())
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  if (!open) return null

  const handleNew = async () => {
    await newProject('未命名项目')
    setOpen(false)
  }

  const handleOpen = (p: ProjectRecord) => {
    if (p.id !== currentId) {
      void loadProject(p.id)
    }
    setOpen(false)
  }

  const handleDelete = async (p: ProjectRecord) => {
    if (!window.confirm(`确定删除项目「${p.name}」吗？其中的媒体文件也会被清理。`)) return
    await db.projects.delete(p.id)
    await deleteProjectFromCloud(p.id)
    await gcAssets()
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
      }
    }
    await refresh()
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
          <span className="text-lg font-bold tracking-wide">SuQCanvas</span>
          <span className="text-xs text-dim">无限画布 · 项目总览</span>
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
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
          >
            导入 .sqcanvas
          </button>
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
            className="group flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-edge2 bg-panel px-6 py-5 transition-colors hover:border-sky-500/60 hover:bg-hover/40"
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

        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-dim">
          全部项目（{projects.length}）
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-edge bg-panel py-16 text-center text-sm text-dim">
            暂无项目，点击上方「新建项目」开始
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`group flex flex-col overflow-hidden rounded-2xl border bg-panel transition-colors hover:border-sky-500/50 ${
                  p.id === currentId ? 'border-sky-600' : 'border-edge'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleOpen(p)}
                  className="relative h-36 w-full cursor-pointer bg-panel2/50 p-1.5"
                  title={`打开「${p.name}」`}
                >
                  <ProjectThumb nodes={p.graph.nodes} edges={p.graph.edges} />
                  {p.id === currentId && (
                    <span className="absolute right-2 top-2 rounded bg-sky-600/80 px-1.5 py-0.5 text-[10px] text-white">
                      当前
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
                      onClick={() => handleOpen(p)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-soft hover:text-sky-500"
                      title={p.name}
                    >
                      {p.name}
                    </button>
                  )}
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
                      title="删除"
                      onClick={() => void handleDelete(p)}
                      className="rounded px-1.5 py-1 text-xs text-rose-500 hover:bg-hover"
                    >
                      删除
                    </button>
                  </div>
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
