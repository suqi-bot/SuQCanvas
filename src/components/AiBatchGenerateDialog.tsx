import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvasStore } from '../store/canvasStore'
import { useAiStore } from '../ai/store'
import { useProjectStore } from '../store/projectStore'
import { generateAiNode } from '../ai/generation'
import { aiJobKey } from '../ai/taskTypes'
import { findLinkedPromptNode, readPromptContent } from '../ai/promptLink'
import { isNodeLockedByOther } from '../sync/lanClient'
import { toast } from '../store/uiStore'

const button = 'rounded-md border border-edge2 px-3 py-2 text-xs text-soft hover:bg-hover disabled:opacity-40'

interface Candidate {
  id: string
  label: string
  prompt: string
  hasOwnPrompt: boolean
  blockedReason: string
  canGenerate: boolean
}

export function AiBatchGenerateDialog({ currentId, fallbackPrompt, onClose }: {
  currentId: string
  fallbackPrompt: string
  onClose: () => void
}) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const jobs = useAiStore((s) => s.jobs)
  const projectId = useProjectStore((s) => s.projectId)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // null 表示尚未手动勾选:跟随实时可生成集合;一旦用户操作则固定为显式集合
  const [selected, setSelected] = useState<Set<string> | null>(null)

  useEffect(() => { dialogRef.current?.showModal() }, [])

  const candidates = useMemo<Candidate[]>(() => nodes.filter((n) => n.data.ai).map((n) => {
    const ai = n.data.ai!
    const linked = findLinkedPromptNode(n.id, nodes, edges)
    const linkedContent = linked ? readPromptContent(linked) : null
    const own = ((linkedContent ? linkedContent.prompt : (ai.draftPrompt ?? ai.prompt)) ?? '').trim()
    const prompt = own || fallbackPrompt.trim()
    const running = !!jobs[aiJobKey(projectId, n.id)]?.running
    const locked = isNodeLockedByOther(n.id)
    const editMode = (linkedContent?.genMode ?? ai.genMode ?? 'text') === 'edit'
    const blockedReason = locked ? '他人编辑中'
      : running ? '生成中'
        : editMode && !n.data.assetId ? '图生图缺少原图'
          : !prompt ? '没有提示词' : ''
    return { id: n.id, label: n.data.label ?? 'AI 图片', prompt, hasOwnPrompt: !!own, blockedReason, canGenerate: !blockedReason }
  }), [nodes, edges, jobs, projectId, fallbackPrompt])

  const activeIds = useMemo(() => candidates.filter((c) => c.canGenerate).map((c) => c.id), [candidates])
  const effectiveSelected = selected ?? new Set(activeIds)

  function toggle(id: string) {
    const next = new Set(selected ?? activeIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function start() {
    const chosen = candidates.filter((c) => effectiveSelected.has(c.id) && c.canGenerate)
    if (!chosen.length) return
    onClose()
    for (const candidate of chosen) void generateAiNode(candidate.id, candidate.prompt)
    toast(`已提交 ${chosen.length} 个生成任务`, 'success')
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="ai-batch-title"
      className="fixed inset-0 m-auto max-h-[80vh] w-[560px] max-w-[95vw] overflow-y-auto rounded-xl border border-edge2 bg-panel p-5 text-main shadow-2xl backdrop:bg-black/60"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onKeyDown={(event) => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="ai-batch-title" className="text-sm font-semibold">批量生成 · 选择节点</h2>
        <button type="button" className={button} onClick={onClose}>关闭</button>
      </div>
      <p className="mb-3 text-xs text-mid">勾选画布上的 AI 图片节点后批量提交。每个节点优先使用自己的提示词；没有提示词的节点将使用当前输入框的内容。模型与尺寸按全局设置。</p>
      {candidates.length === 0 && <p className="rounded-md bg-hover px-3 py-6 text-center text-xs text-mid">画布上没有 AI 图片节点</p>}
      {candidates.length > 0 && <>
        <div className="mb-2 flex items-center gap-3 text-xs text-mid">
          <span>已选 {activeIds.filter((id) => effectiveSelected.has(id)).length} / {candidates.length}</span>
          <button type="button" className="text-sky-500 hover:underline" onClick={() => setSelected(new Set(activeIds))}>全选可生成</button>
          <button type="button" className="text-sky-500 hover:underline" onClick={() => setSelected(new Set())}>清空</button>
        </div>
        <ul className="space-y-1">
          {candidates.map((c) => (
            <li key={c.id}>
              <label className={`flex items-start gap-2 rounded-md px-2 py-2 ${c.canGenerate ? 'cursor-pointer hover:bg-hover' : 'opacity-50'}`}>
                <input type="checkbox" className="mt-0.5 accent-sky-600" disabled={!c.canGenerate}
                  checked={effectiveSelected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="truncate">{c.label}</span>
                    {c.id === currentId && <span className="shrink-0 text-[10px] text-sky-500">当前</span>}
                    {c.blockedReason && <span className="shrink-0 text-[10px] text-mid">{c.blockedReason}</span>}
                    {!c.hasOwnPrompt && c.canGenerate && <span className="shrink-0 text-[10px] text-sky-500">用当前提示词</span>}
                  </span>
                  <span className="block truncate text-xs text-mid" title={c.prompt}>{c.prompt || '（空）'}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>取消</button>
          <button type="button" className="rounded-md bg-sky-600 px-3 py-2 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!chosenCount(effectiveSelected, candidates)}
            onClick={start}>{`生成所选（${chosenCount(effectiveSelected, candidates)}）`}</button>
        </div>
      </>}
    </dialog>, document.body)
}

function chosenCount(selected: Set<string>, candidates: Candidate[]): number {
  return candidates.filter((c) => selected.has(c.id) && c.canGenerate).length
}
