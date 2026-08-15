import { useCallback, useEffect, useRef, useState } from 'react'
import { db, gcAssets } from '../db/db'
import type { ProjectRecord } from '../db/db'
import { useProjectStore } from '../store/projectStore'
import { useUiStore, toast } from '../store/uiStore'
import { exportProjectToBlob, downloadBlob, importProjectFile } from '../io/importExport'
import { useCanvasStore } from '../store/canvasStore'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ProjectManager() {
  const open = useUiStore((s) => s.managerOpen)
  const setOpen = useUiStore((s) => s.setManagerOpen)
  const currentId = useProjectStore((s) => s.projectId)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)
  const renameProject = useProjectStore((s) => s.renameProject)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const importRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    const list = await db.projects.orderBy('updatedAt').reverse().toArray()
    setProjects(list)
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const handleNew = async () => {
    await newProject('未命名项目')
    setOpen(false)
  }

  const handleDelete = async (p: ProjectRecord) => {
    if (!window.confirm(`确定删除项目「${p.name}」吗？其中的媒体文件也会被清理。`)) return
    await db.projects.delete(p.id)
    await gcAssets()
    if (currentId === p.id) {
      const remaining = await db.projects.orderBy('updatedAt').last()
      if (remaining) {
        await loadProject(remaining.id)
      } else {
        await newProject('未命名项目')
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

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-2xl border border-edge2 bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="text-sm font-semibold text-main">项目管理</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
            >
              导入 .sqcanvas
            </button>
            <button
              type="button"
              onClick={() => void handleNew()}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              新建项目
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1.5 text-xs text-mid hover:bg-hover hover:text-main"
            >
              关闭 ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {projects.length === 0 ? (
            <div className="py-12 text-center text-sm text-dim">暂无项目</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                    p.id === currentId
                      ? 'border-sky-600 bg-sky-500/10'
                      : 'border-edge bg-panel hover:bg-panel2'
                  }`}
                >
                  {renaming === p.id ? (
                    <input
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void renameProject(p.id, renameValue.trim() || p.name)
                          setRenaming(null)
                          void refresh()
                        }
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => {
                        void renameProject(p.id, renameValue.trim() || p.name)
                        setRenaming(null)
                        void refresh()
                      }}
                      className="min-w-0 flex-1 rounded border border-sky-600 bg-panel px-2 py-1 text-sm text-main outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (p.id !== currentId) {
                          void loadProject(p.id).then(() => setOpen(false))
                        } else {
                          setOpen(false)
                        }
                      }}
                      className="min-w-0 flex-1 truncate text-left text-sm text-soft hover:text-sky-500"
                      title={p.name}
                    >
                      {p.name}
                      {p.id === currentId && (
                        <span className="ml-2 rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] text-sky-300">
                          当前
                        </span>
                      )}
                    </button>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-dim">
                    {fmtTime(p.updatedAt)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="导出"
                      onClick={() => void handleExport(p)}
                      className="rounded px-2 py-1 text-xs text-mid hover:bg-hover hover:text-main"
                    >
                      导出
                    </button>
                    <button
                      type="button"
                      title="重命名"
                      onClick={() => {
                        setRenaming(p.id)
                        setRenameValue(p.name)
                      }}
                      className="rounded px-2 py-1 text-xs text-mid hover:bg-hover hover:text-main"
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      title="删除"
                      onClick={() => void handleDelete(p)}
                      className="rounded px-2 py-1 text-xs text-rose-500 hover:bg-hover"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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
    </div>
  )
}
