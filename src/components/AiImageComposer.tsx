import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useInternalNode, useReactFlow, useViewport } from '@xyflow/react'
import { useAiStore } from '../ai/store'
import { generateAiNode, generationSettings, stopAiGeneration } from '../ai/generation'
import { composerPosition } from '../ai/composerPosition'
import { aiJobKey } from '../ai/taskTypes'
import { useProjectStore } from '../store/projectStore'
import { optimizePrompt, type OptimizedPrompts } from '../ai/client'
import { findLinkedPromptNode, readPromptContent, updatePromptNodeContent } from '../ai/promptLink'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'
import type { SuqNodeData } from '../types'

export function AiImageComposer({ id, ai, visible, locked }: { id: string; ai: NonNullable<SuqNodeData['ai']>; visible: boolean; locked: boolean }) {
  const { zoom } = useViewport()
  const overlayOpen = useUiStore((s) => !!(s.homeOpen || s.imageViewer || s.pdfViewer || s.markdownViewer || s.playerPage || s.fileManagerOpen))
  const shown = visible && !overlayOpen
  const node = useInternalNode(id)
  const { flowToScreenPosition } = useReactFlow()
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState(260)
  const [screen, setScreen] = useState({ width: window.innerWidth, height: window.innerHeight })
  const settings = useAiStore((s) => s.settings)
  const config = generationSettings(ai, settings)
  const projectId = useProjectStore((s) => s.projectId)
  const job = useAiStore((s) => s.jobs[aiJobKey(projectId, id)])
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const linkedPromptNode = useMemo(() => findLinkedPromptNode(id, nodes, edges), [id, nodes, edges])
  const promptFromLink = !!locked || !!linkedPromptNode
  const linkedContent = linkedPromptNode ? readPromptContent(linkedPromptNode) : null
  const [prompt, setPrompt] = useState(ai.draftPrompt ?? ai.prompt)
  const [optimized, setOptimized] = useState<OptimizedPrompts | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState('')
  const sourcePrompt = promptFromLink && linkedContent ? linkedContent.prompt : (ai.draftPrompt ?? ai.prompt)
  const sourceNegative = promptFromLink && linkedContent
    ? linkedContent.negativePrompt
    : (ai.draftNegativePrompt ?? config.negativePrompt ?? '')
  useEffect(() => { setPrompt(sourcePrompt); setOptimized(null) }, [sourcePrompt, ai.prompt, ai.draftPrompt, ai.draftNegativePrompt, config.negativePrompt])
  useEffect(() => {
    const resize = () => setScreen({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useLayoutEffect(() => {
    if (!shown || !panelRef.current) return
    const observer = new ResizeObserver(() => setPanelHeight(panelRef.current?.getBoundingClientRect().height ?? 260))
    observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [shown])
  const busy = !!job?.running
  const editLocked = busy || locked || optimizing || promptFromLink
  const genMode = (promptFromLink && linkedContent ? linkedContent.genMode : ai.genMode) ?? 'text'
  const editMode = genMode === 'edit'
  const hasImage = !!nodes.find((n) => n.id === id)?.data.assetId
  const canSend = !busy && !locked && !optimizing && !!prompt.trim() && (!editMode || hasImage)
  function edit(value: string) {
    if (editLocked) return
    setPrompt(value); setOptimized(null); setError('')
    const current = useCanvasStore.getState().nodes.find((n) => n.id === id)
    if (current?.data.ai) useCanvasStore.getState().updateNodeData(id, { ai: { ...current.data.ai, draftPrompt: value } })
  }
  if (!shown || !node) return null
  const position = flowToScreenPosition(node.internals.positionAbsolute)
  const placement = composerPosition({ ...position, width: (node.measured.width ?? 320) * zoom,
    height: (node.measured.height ?? 240) * zoom }, { width: 460, height: panelHeight }, screen, 32 * zoom + 12)
  return createPortal(
    <div ref={panelRef} style={placement} className="nodrag nopan nowheel fixed z-[70] overflow-y-auto rounded-2xl border border-edge2 bg-panel p-3 text-main shadow-2xl"
      role="region" aria-label="AI 图片提示词"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') useUiStore.getState().openAiNode(null) }}>
      <div className="flex items-center justify-between px-1 text-xs text-mid"><span>{busy ? '✦ 正在后台生成，可继续编辑画布' : '✦ AI 图片'}</span>
        <button type="button" aria-label="关闭提示词输入框" className="rounded px-2 py-1 hover:bg-hover" onClick={() => useUiStore.getState().openAiNode(null)}>×</button></div>
      {promptFromLink && <p className="mt-1 rounded-md bg-sky-500/10 px-2 py-1.5 text-xs text-sky-500">已连接提示词节点，此处不可修改；请在提示词节点中编辑。</p>}
      <div className="flex items-center gap-2 px-1 text-xs text-mid">
        <label className="flex items-center gap-1.5">生成方式
          <select aria-label="生成方式" className="rounded border border-edge2 bg-panel px-2 py-1 text-soft outline-none"
            disabled={busy || optimizing} value={genMode}
            onChange={(e) => {
              const value = e.target.value as 'text' | 'edit'
              if (promptFromLink && linkedPromptNode) updatePromptNodeContent(linkedPromptNode.id, { genMode: value })
              else {
                const current = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.ai
                if (current) useCanvasStore.getState().updateNodeData(id, { ai: { ...current, genMode: value } })
              }
            }}>
            <option value="text">文生图</option>
            <option value="edit">图生图（编辑当前图片）</option>
          </select>
        </label>
        {editMode && <span className={hasImage ? 'truncate' : 'text-rose-500'}>{hasImage ? '将编辑当前图片，完成后对比应用' : '节点还没有图片，无法图生图'}</span>}
      </div>
      <textarea aria-label="图片生成需求" placeholder="描述你想生成的画面…" value={prompt} disabled={editLocked}
        className="nowheel mt-1 min-h-24 w-full resize-y border-0 bg-transparent px-1 py-2 text-sm outline-none disabled:opacity-60"
        onChange={(e) => edit(e.target.value)} onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && canSend) { e.preventDefault(); void generateAiNode(id, prompt) }
        }} />
      <details className="mb-2 text-xs text-mid" open={promptFromLink}><summary className="cursor-pointer">反向提示词</summary>
        <textarea aria-label="反向提示词" placeholder="不希望出现的内容" disabled={editLocked}
          className="nodrag mt-2 w-full resize-y rounded border border-edge2 bg-transparent p-2 text-main"
          value={sourceNegative}
          onChange={(e) => {
            if (editLocked) return
            const current = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.ai
            if (current) useCanvasStore.getState().updateNodeData(id, { ai: { ...current, draftNegativePrompt: e.target.value } })
          }} />
      </details>
      {optimized && <div className="mb-3 max-h-44 overflow-auto rounded-lg bg-hover p-3 text-xs">
        <p className="mb-1 text-mid">正向提示词</p><p className="whitespace-pre-wrap">{optimized.prompt}</p>
        <p className="mb-1 mt-3 text-mid">负面提示词</p><p className="whitespace-pre-wrap">{optimized.negativePrompt || '（留空）'}</p>
        <button disabled={editLocked} className="mt-2 text-sky-500 disabled:opacity-40" onClick={() => {
          const current = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.ai
          if (current) useCanvasStore.getState().updateNodeData(id, { ai: { ...current, draftPrompt: optimized.prompt, draftNegativePrompt: optimized.negativePrompt } })
          setPrompt(optimized.prompt); setOptimized(null); setError('')
        }}>同时采用正向和负面提示词</button>
        <button className="ml-4 text-mid" onClick={() => setOptimized(null)}>保留原文</button>
      </div>}
      <div className="flex items-center gap-2">
        <button type="button" title="AI 生图设置" className="rounded-full px-2 py-1 text-mid hover:bg-hover" onClick={() => useAiStore.getState().setSettingsOpen(true)}>⚙</button>
        <button type="button" className="rounded-lg px-2 py-1.5 text-xs text-soft hover:bg-hover disabled:opacity-40" disabled={busy || optimizing || editLocked || !prompt.trim()}
          onClick={async () => {
            setOptimizing(true); setError(''); setOptimized(null)
            const { settings: llmConfig, llmKey } = useAiStore.getState()
            try { setOptimized(await optimizePrompt({ url: llmConfig.llmUrl, key: llmKey, model: llmConfig.llmModel }, prompt, sourceNegative)) }
            catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
            finally { setOptimizing(false) }
          }}>{optimizing ? '优化中…' : '✧ 优化提示词'}</button>
        {busy ? <button type="button" className="ml-auto shrink-0 rounded-full border border-edge2 px-3 py-2 text-xs" onClick={() => stopAiGeneration(id)}>停止等待</button>
          : <button type="button" aria-label="发送并生成图片" title="发送生成（Ctrl+Enter）" disabled={!canSend}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xl text-white hover:bg-sky-500 disabled:opacity-40"
            onClick={() => void generateAiNode(id, prompt)}>↑</button>}
      </div>
      {ai.generatedAt && <label className="mt-2 flex items-center gap-2 text-xs text-mid">生成参数
        <select aria-label="生成参数来源" className="rounded border border-edge2 bg-panel px-2 py-1 text-soft" disabled={busy || locked || optimizing} value={ai.parameterSource ?? 'current'} onChange={(e) => {
          const current = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.ai
          if (current) useCanvasStore.getState().updateNodeData(id, { ai: { ...current, parameterSource: e.target.value as 'current' | 'original' } })
        }}><option value="current">使用当前设置</option><option value="original">沿用原图参数（固定种子）</option></select>
      </label>}
      {(error || job?.error) && <p role="alert" className="mt-2 max-h-24 overflow-auto break-words text-xs text-rose-500">{error || job?.error}</p>}
      {job?.message && <p role="status" className="mt-2 truncate text-xs text-mid" title={job.message}>{job.message}</p>}
    </div>
  , document.body)
}
