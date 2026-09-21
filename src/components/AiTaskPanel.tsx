import { useEffect, useState } from 'react'
import { useAiStore } from '../ai/store'
import { aiOwner, applyAiTask, hasRunningAiTasks, recoverAiTasks, resumeAiTask, stopAiGeneration } from '../ai/generation'
import { useProjectStore } from '../store/projectStore'
import { useAuthStore } from '../store/authStore'
import { toast, useUiStore } from '../store/uiStore'
import { db } from '../db/db'
import { downloadBlob } from '../io/importExport'
import type { AiTask } from '../ai/taskTypes'

export function AiTaskPanel() {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const tasks = useAiStore((s) => s.tasks)
  const projectId = useProjectStore((s) => s.projectId)
  const initialized = useProjectStore((s) => s.initialized)
  const busy = useProjectStore((s) => s.busy)
  const userId = useAuthStore((s) => s.user?.id)
  const mine = tasks.filter((t) => t.owner === (userId ?? 'local')).sort((a, b) => b.createdAt - a.createdAt)
  const running = mine.filter((t) => t.state === 'running').length
  useEffect(() => {
    if (initialized && !busy) void recoverAiTasks().catch(() => toast('AI 任务记录读取失败', 'error'))
  }, [initialized, busy, projectId, userId])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!window.suqDesktop && hasRunningAiTasks()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  async function action(id: string, work: () => Promise<void>) {
    setWorking(id)
    try { await work() } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
    finally { setWorking(null) }
  }
  async function view(task: AiTask) {
    if (task.owner !== aiOwner()) return
    if (projectId !== task.projectId) await useProjectStore.getState().loadProject(task.projectId)
    if (useProjectStore.getState().projectId !== task.projectId) return
    await applyAiTask(task.id)
    useUiStore.getState().setHomeOpen(false)
    window.dispatchEvent(new CustomEvent('sq:focus-node', { detail: { nodeId: task.nodeId } }))
    useUiStore.getState().openAiNode(task.nodeId)
    setOpen(false)
  }
  async function download(task: AiTask) {
    const fresh = await db.aiTasks.get(task.id)
    if (!fresh) return
    for (let i = 0; i < Math.max(fresh.blobs?.length ?? 0, fresh.resultNodes?.length ?? 0); i++) {
      const assetId = fresh.resultNodes?.[i].data.assetId
      const asset = assetId ? await db.assets.get(assetId) : undefined
      const blob = fresh.blobs?.[i] ?? asset?.blob
      if (!blob) { toast('此图片已被清理', 'error'); continue }
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
      if (!(await downloadBlob(blob, asset?.name ?? `AI-${task.id}-${i + 1}.${extension}`))) break
    }
  }
  return <div className="shrink-0">
    <button className="rounded-md border border-edge2 px-3 py-2 text-xs text-soft hover:bg-hover" onClick={() => setOpen(!open)}>AI 任务{running ? ` · ${running} 进行中` : ''}</button>
    {open && <section role="region" aria-label="AI 任务列表" className="fixed right-4 top-16 z-[85] max-h-[75vh] w-96 max-w-[calc(100vw-32px)] overflow-auto rounded-xl border border-edge2 bg-panel p-4 text-main shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">AI 任务</h2><button aria-label="关闭任务列表" onClick={() => setOpen(false)}>×</button></div>
      {!mine.length && <p className="text-xs text-mid">暂无生成任务</p>}
      {mine.map((task) => <article key={task.id} className="mb-3 rounded-lg border border-edge p-3 text-xs">
        <div className="truncate font-medium">{task.projectName}</div>
        <p className="my-2 line-clamp-2 text-soft">{task.info.prompt}</p>
        <p className="break-words text-mid">{task.message}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sky-500">
          <button disabled={busy || !!working} onClick={() => void action(task.id, () => view(task))}>查看项目</button>
          {task.state === 'running' ? <button onClick={() => stopAiGeneration(task.nodeId, task.projectId)}>停止等待</button>
            : (task.promptId || (task.grid && task.sourceBlob)) && !['ready', 'done'].includes(task.state) && <button onClick={() => void resumeAiTask(task.id).catch((error) => toast(String(error), 'error'))}>恢复等待</button>}
          {task.state === 'ready' && <button disabled={!!working || busy} onClick={() => void action(task.id, () => applyAiTask(task.id))}>重试写入</button>}
          {(task.blobs?.length || task.resultNodes?.length) ? <button disabled={!!working} onClick={() => void action(task.id, () => download(task))}>下载图片</button> : null}
        </div>
      </article>)}
    </section>}
  </div>
}
