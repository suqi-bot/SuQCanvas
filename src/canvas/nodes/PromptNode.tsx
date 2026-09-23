import { memo, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { useCanvasStore } from '../../store/canvasStore'
import { useAiStore } from '../../ai/store'
import { useProjectStore } from '../../store/projectStore'
import { optimizePrompt, type OptimizedPrompts } from '../../ai/client'
import { generateAiNode } from '../../ai/generation'
import { aiJobKey } from '../../ai/taskTypes'
import { fillAiFromPrompt, findAiTargetsForPrompt, readPromptContent, updatePromptNodeContent } from '../../ai/promptLink'
import { MediaNodeShell } from './MediaNodeShell'
import { ResizeHandles } from './ResizeHandles'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'

export const PromptNode = memo(function PromptNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const updatePromptNode = updatePromptNodeContent
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const [optimized, setOptimized] = useState<OptimizedPrompts | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const content = readPromptContent({ id, data } as SuqNode)
  const targets = findAiTargetsForPrompt(id, nodes, edges)
  const linkedCount = targets.length
  const projectId = useProjectStore((s) => s.projectId)
  const jobs = useAiStore((s) => s.jobs)
  const generating = targets.some((target) => jobs[aiJobKey(projectId, target.id)]?.running)

  useEffect(() => {
    if (data.autoEdit) {
      setEditing(true)
      useCanvasStore.getState().updateNodeData(id, { autoEdit: false })
    }
  }, [data.autoEdit, id])

  useEffect(() => {
    if (editing) setLanEditing(id, data.label ?? '提示词')
    else clearLanEditing()
    return () => clearLanEditing()
  }, [editing, id, data.label])

  async function runOptimize() {
    if (!content.prompt.trim() || optimizing) return
    setOptimizing(true)
    setError('')
    setOptimized(null)
    const { settings, llmKey } = useAiStore.getState()
    try {
      setOptimized(
        await optimizePrompt(
          { url: settings.llmUrl, key: llmKey, model: settings.llmModel },
          content.prompt,
          content.negativePrompt,
        ),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setOptimizing(false)
    }
  }

  function applyOptimized() {
    if (!optimized) return
    updatePromptNode(id, { prompt: optimized.prompt, negativePrompt: optimized.negativePrompt })
    setOptimized(null)
    setError('')
  }

  function runGenerate() {
    if (!content.prompt.trim() || !targets.length) return
    for (const target of targets) {
      fillAiFromPrompt(target.id, content)
      void generateAiNode(target.id, content.prompt)
    }
  }

  return (
    <MediaNodeShell node={props} alwaysShowBar>
      <div className="flex h-full min-h-0 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-sky-500">✦ 提示词</span>
          <span className="truncate text-[10px] text-mid" title={linkedCount ? `已连接 ${linkedCount} 张 AI 图片` : '连线到 AI 图片后自动填充'}>
            {linkedCount ? `已连接 ${linkedCount} 张` : '未连接'}
          </span>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-mid">
          生成方式
          <select
            aria-label="生成方式"
            className="rounded border border-edge2 bg-panel px-2 py-1 text-soft outline-none"
            value={content.genMode ?? 'text'}
            onChange={(e) => updatePromptNode(id, { genMode: e.target.value as 'text' | 'edit' })}
          >
            <option value="text">文生图</option>
            <option value="edit">图生图（编辑当前图片）</option>
          </select>
        </label>

        <label className="flex min-h-0 flex-1 flex-col gap-1 text-[11px] text-mid">
          正向提示词
          <textarea
            aria-label="正向提示词"
            placeholder="描述你想生成的画面…"
            className="nodrag nowheel min-h-16 w-full flex-1 resize-none rounded border border-edge2 bg-transparent p-2 text-sm text-main outline-none placeholder:text-dim focus:border-sky-500/60"
            value={content.prompt}
            disabled={optimizing}
            onFocus={() => setEditing(true)}
            onChange={(e) => {
              setOptimized(null)
              setError('')
              updatePromptNode(id, { prompt: e.target.value })
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setEditing(false)
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-mid">
          反向提示词
          <textarea
            aria-label="反向提示词"
            placeholder="不希望出现的内容"
            className="nodrag nowheel min-h-10 w-full resize-y rounded border border-edge2 bg-transparent p-2 text-xs text-main outline-none placeholder:text-dim focus:border-sky-500/60"
            value={content.negativePrompt}
            disabled={optimizing}
            onFocus={() => setEditing(true)}
            onChange={(e) => {
              setOptimized(null)
              setError('')
              updatePromptNode(id, { negativePrompt: e.target.value })
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setEditing(false)
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
        </label>

        {optimized && (
          <div className="max-h-28 overflow-auto rounded-md bg-hover p-2 text-[11px]">
            <p className="text-mid">正向</p>
            <p className="whitespace-pre-wrap text-main">{optimized.prompt}</p>
            <p className="mt-1 text-mid">反向</p>
            <p className="whitespace-pre-wrap text-main">{optimized.negativePrompt}</p>
            <div className="mt-1.5 flex gap-3">
              <button type="button" className="text-sky-500 disabled:opacity-40" disabled={optimizing} onClick={applyOptimized}>
                同时采用
              </button>
              <button type="button" className="text-mid" onClick={() => setOptimized(null)}>
                保留原文
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-edge2 px-2 py-1 text-[11px] text-soft hover:bg-hover disabled:opacity-40"
            disabled={optimizing || !content.prompt.trim()}
            onClick={() => void runOptimize()}
          >
            {optimizing ? '优化中…' : '✧ 优化提示词'}
          </button>
          <button
            type="button"
            title="AI 生图设置"
            className="rounded-md px-1.5 py-1 text-mid hover:bg-hover"
            onClick={() => useAiStore.getState().setSettingsOpen(true)}
          >
            ⚙
          </button>
          {(error) && <p role="alert" className="min-w-0 flex-1 truncate text-[10px] text-rose-500" title={error}>{error}</p>}
          <button
            type="button"
            className="ml-auto rounded-md bg-sky-600 px-3 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!content.prompt.trim() || !linkedCount || generating}
            title={linkedCount ? `对已连接的 ${linkedCount} 张 AI 图片提交生成` : '请先连线到 AI 图片节点'}
            onClick={runGenerate}
          >
            {generating ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
      {selected && !editing && <ResizeHandles nodeId={id} />}
    </MediaNodeShell>
  )
})
