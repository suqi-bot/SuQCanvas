import { useEffect, useState } from 'react'
import { NodeToolbar, Position, useViewport } from '@xyflow/react'
import { useAiStore } from '../ai/store'
import { generateAiNode, stopAiGeneration } from '../ai/generation'
import { optimizePrompt } from '../ai/client'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'
import type { SuqNodeData } from '../types'

export function AiImageComposer({ id, ai, visible, locked }: { id: string; ai: NonNullable<SuqNodeData['ai']>; visible: boolean; locked: boolean }) {
  const { zoom } = useViewport()
  const settings = useAiStore((s) => s.settings)
  const job = useAiStore((s) => s.jobs[id])
  const [prompt, setPrompt] = useState(ai.prompt)
  const [optimized, setOptimized] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setPrompt(ai.prompt) }, [ai.prompt])
  const busy = !!job?.running
  function edit(value: string) {
    setPrompt(value); setOptimized(''); setError('')
    const node = useCanvasStore.getState().nodes.find((n) => n.id === id)
    if (node?.data.ai && !node.data.assetId) useCanvasStore.getState().updateNodeData(id, { ai: { ...node.data.ai, prompt: value } })
  }
  return <NodeToolbar nodeId={id} isVisible={visible} position={Position.Bottom} offset={32 * zoom + 12}>
    <div className="nodrag nopan nowheel w-[460px] max-w-[calc(100vw-32px)] rounded-2xl border border-edge2 bg-panel p-3 text-main shadow-2xl"
      role="region" aria-label="AI 图片提示词"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') useUiStore.getState().openAiNode(null) }}>
      <div className="flex items-center justify-between px-1 text-xs text-mid"><span>{busy ? '✦ 正在后台生成，可继续编辑画布' : '✦ AI 图片'}</span>
        <button type="button" aria-label="关闭提示词输入框" className="rounded px-2 py-1 hover:bg-hover" onClick={() => useUiStore.getState().openAiNode(null)}>×</button></div>
      <textarea aria-label="图片生成需求" placeholder="描述你想生成的画面…" value={prompt} disabled={busy || locked}
        className="nowheel mt-1 min-h-24 w-full resize-y border-0 bg-transparent px-1 py-2 text-sm outline-none disabled:opacity-60"
        onChange={(e) => edit(e.target.value)} onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && !busy && !locked && !optimizing) { e.preventDefault(); void generateAiNode(id, prompt) }
        }} />
      {optimized && <div className="mb-3 max-h-44 overflow-auto rounded-lg bg-hover p-3 text-xs">
        <p className="whitespace-pre-wrap">{optimized}</p><button className="mt-2 text-sky-500" onClick={() => edit(optimized)}>采用优化提示词</button>
        <button className="ml-4 text-mid" onClick={() => setOptimized('')}>保留原文</button>
      </div>}
      <div className="flex items-center gap-2">
        <button type="button" title="AI 生图设置" className="rounded-full px-2 py-1 text-mid hover:bg-hover" onClick={() => useAiStore.getState().setSettingsOpen(true)}>⚙</button>
        <button type="button" className="rounded-lg px-2 py-1.5 text-xs text-soft hover:bg-hover disabled:opacity-40" disabled={busy || optimizing || locked || !prompt.trim()}
          onClick={async () => {
            setOptimizing(true); setError('')
            const { settings: config, llmKey } = useAiStore.getState()
            try { setOptimized(await optimizePrompt({ url: config.llmUrl, key: llmKey, model: config.llmModel }, prompt)) }
            catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
            finally { setOptimizing(false) }
          }}>{optimizing ? '优化中…' : '✧ 优化提示词'}</button>
        <span className="ml-auto min-w-0 truncate text-xs text-mid" title={settings.provider === 'comfy' ? 'ComfyUI · 使用 AI 生图设置中的参数' : settings.model}>{settings.provider === 'comfy' ? 'ComfyUI' : settings.model || '未配置模型'}</span>
        {busy ? <button type="button" className="shrink-0 rounded-full border border-edge2 px-3 py-2 text-xs" onClick={() => stopAiGeneration(id)}>停止等待</button>
          : <button type="button" aria-label="发送并生成图片" title="发送生成（Ctrl+Enter）" disabled={locked || optimizing || !prompt.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xl text-white hover:bg-sky-500 disabled:opacity-40"
            onClick={() => void generateAiNode(id, prompt)}>↑</button>}
      </div>
      {(error || job?.error) && <p role="alert" className="mt-2 max-h-24 overflow-auto break-words text-xs text-rose-500">{error || job?.error}</p>}
      {job?.message && <p role="status" className="mt-2 truncate text-xs text-mid" title={job.message}>{job.message}</p>}
    </div>
  </NodeToolbar>
}
