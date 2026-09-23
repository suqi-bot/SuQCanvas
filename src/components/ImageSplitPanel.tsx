import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { SuqNode } from '../types'
import { useAiStore, splitCount } from '../ai/store'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { createAiNode } from '../io/fileLoader'
import { db } from '../db/db'
import { baseUrl, parseWorkflow, prepareWorkflow, type Binding } from '../ai/client'
import { generateAiNode, generateGridNode } from '../ai/generation'
import { gridCells } from '../ai/gridSplit'
import { isNodeLockedByOther } from '../sync/lanClient'

export function ImageSplitPanel({ nodeId, url, close }: { nodeId: string; url: string; close: () => void }) {
  const splitPromptBinding = useAiStore((s) => s.settings.splitPromptBinding)
  const splitNegativeBinding = useAiStore((s) => s.settings.splitNegativeBinding)
  const splitProvider = useAiStore((s) => s.settings.splitProvider)
  const [mode, setMode] = useState<'grid' | 'ai'>('grid')
  const [grid, setGrid] = useState({ rows: 2, columns: 2, gap: 0, margin: 0 })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [prompt, setPrompt] = useState('将图片拆为主体、背景等独立图层')
  const [negative, setNegative] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  let cells: ReturnType<typeof gridCells> = []
  let gridError = ''
  if (dimensions.width) {
    try { cells = gridCells(dimensions.width, dimensions.height, grid.rows, grid.columns, grid.gap, grid.margin) }
    catch (reason) { gridError = String(reason) }
  }
  async function start() {
    if (busy) return
    setBusy(true); setError('')
    const projectId = useProjectStore.getState().projectId
    try {
      const source = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
      if (!source?.data.assetId || isNodeLockedByOther(nodeId)) throw new Error('原图不可用或正被他人编辑')
      const settings = useAiStore.getState().settings
      if (mode === 'ai') {
        if (settings.splitProvider !== 'comfy') {
          baseUrl(settings.splitCloudUrl || settings.cloudUrl)
          if (!(settings.splitModel || settings.model).trim()) throw new Error('请先在图生图设置中填写模型名称')
        } else {
          baseUrl(settings.comfyUrl)
          const workflow = parseWorkflow(settings.splitWorkflow || '{}')
          const image: Binding = JSON.parse(settings.splitImageBinding || '{}')
          if (typeof workflow[image.node]?.inputs[image.input] !== 'string') throw new Error('请先在 AI 生图设置中配置图生图工作流及原图输入')
          if (negative.trim() && !settings.splitNegativeBinding) throw new Error('请先绑定图生图工作流的反向提示词输入')
          if ([settings.splitPromptBinding, settings.splitNegativeBinding].includes(settings.splitImageBinding)) throw new Error('图片输入不能同时绑定提示词')
          if (settings.splitPromptBinding) prepareWorkflow(workflow, JSON.parse(settings.splitPromptBinding), prompt, false,
            settings.splitNegativeBinding ? { binding: JSON.parse(settings.splitNegativeBinding), prompt: negative } : undefined)
          else if (settings.splitNegativeBinding) prepareWorkflow(workflow, JSON.parse(settings.splitNegativeBinding), negative, false)
        }
      } else gridCells(dimensions.width, dimensions.height, grid.rows, grid.columns, grid.gap, grid.margin)
      const asset = await db.assets.get(source.data.assetId)
      const response = asset?.blob ? undefined : await fetch(url)
      if (response && !response.ok) throw new Error('原图下载失败')
      const blob = asset?.blob ?? await response!.blob()
      if (blob.size > 32 * 1024 * 1024 && mode === 'ai') throw new Error('图生图原图不能超过 32MB')
      if (useProjectStore.getState().projectId !== projectId || useProjectStore.getState().busy || !useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) throw new Error('项目已切换或原图已删除，请重新打开图生图')
      const target: SuqNode = createAiNode({ x: source.position.x + (source.measured?.width ?? source.width ?? 320) + 60, y: source.position.y })
      target.parentId = source.parentId
      target.data.label = mode === 'grid' ? '网格裁切' : '图生图'
      if (mode === 'ai') {
        if (settings.splitProvider !== 'comfy') {
          target.data.ai = { ...target.data.ai!, provider: 'compatible',
            apiStyle: settings.splitProvider === 'dashscope' ? 'dashscope' : 'openai',
            serviceUrl: settings.splitCloudUrl || settings.cloudUrl,
            model: settings.splitModel || settings.model, size: settings.size,
            workflow: '', binding: '', negativePrompt: negative, draftNegativePrompt: negative,
            splitCount: splitCount(settings.splitCount),
            prompt: prompt.trim() || '拆分为独立图层', parameterSource: 'original' }
        } else {
          target.data.ai = { ...target.data.ai!, provider: 'comfy', serviceUrl: settings.comfyUrl,
            workflow: settings.splitWorkflow, binding: settings.splitPromptBinding, negativeBinding: settings.splitNegativeBinding,
            imageBinding: settings.splitImageBinding, negativePrompt: negative, draftNegativePrompt: negative,
            prompt: prompt.trim() || '分层图生图', parameterSource: 'original' }
        }
      }
      useCanvasStore.getState().addNodes([target])
      if (mode === 'grid') void generateGridNode(target.id, blob, grid)
      else void generateAiNode(target.id, prompt.trim() || (settings.splitProvider === 'comfy' ? '分层图生图' : '拆分为独立图层'), blob)
      close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const aiLabel = splitProvider === 'comfy' ? 'AI 分层' : '图生图'
  return createPortal(<section role="dialog" aria-label="图生图" className="nodrag nopan fixed right-4 top-20 z-[80] max-h-[80vh] w-96 max-w-[calc(100vw-32px)] overflow-auto rounded-xl border border-edge2 bg-panel p-4 text-main shadow-2xl" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close() }} onPointerDown={(e) => e.stopPropagation()}>
    <div className="flex items-center justify-between"><h2>图生图</h2><button aria-label="关闭图生图" onClick={close}>×</button></div>
    <div className="my-3 flex gap-2">{(['grid', 'ai'] as const).map((value) => <button key={value} className={`rounded px-3 py-2 text-xs ${mode === value ? 'bg-sky-600 text-white' : 'bg-hover'}`} onClick={() => setMode(value)}>{value === 'grid' ? '网格裁切' : aiLabel}</button>)}</div>
    <div className="relative mx-auto w-fit max-w-full">
      <img src={url} alt="图生图预览" className="max-h-52 max-w-full" onLoad={(e) => setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
      {mode === 'grid' && cells.map((cell, index) => <div key={index} className="pointer-events-none absolute border border-sky-500 bg-sky-400/10 text-xs text-white" style={{ left: `${cell.x / dimensions.width * 100}%`, top: `${cell.y / dimensions.height * 100}%`, width: `${cell.width / dimensions.width * 100}%`, height: `${cell.height / dimensions.height * 100}%` }}><span className="bg-sky-700 px-1">{index + 1}</span></div>)}
    </div>
    {mode === 'grid' ? <div className="my-3 grid grid-cols-2 gap-3">{([['rows', '行数'], ['columns', '列数'], ['gap', '间距（像素）'], ['margin', '外边距（像素）']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input type="number" min={key === 'rows' || key === 'columns' ? 1 : 0} step={1} className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={grid[key]} onChange={(e) => setGrid({ ...grid, [key]: Number(e.target.value) })} /></label>)}</div>
      : <div className="my-3 space-y-3 text-xs">
        <p className="text-mid">{splitProvider === 'dashscope'
          ? '原图与提示词以 JSON 发送至千问 multimodal-generation 图生图接口，返回图层作为独立图片加入画布。'
          : splitProvider === 'compatible'
            ? '原图发送至 OpenAI 兼容 /images/edits，返回图层会作为独立图片加入画布。'
            : '原图发送至已配置的 ComfyUI，输出图层会作为独立图片加入画布。需要先配置分层工作流。'}</p>
        <button className="text-sky-500" onClick={() => useAiStore.getState().setSettingsOpen(true)}>配置图生图设置</button>
        <label className="block">图生图需求<textarea disabled={splitProvider === 'comfy' && !splitPromptBinding} className="mt-1 w-full rounded border border-edge2 bg-panel p-2 disabled:opacity-40" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        {splitProvider === 'comfy' && !splitPromptBinding && <p className="text-mid">未绑定正向提示词，将按工作流自身的分层配置执行。</p>}
        <label className="block">反向提示词<textarea disabled={splitProvider === 'comfy' && !splitNegativeBinding} placeholder={splitProvider !== 'comfy' || splitNegativeBinding ? '不希望出现的内容' : '需要先在图生图设置中绑定反向输入'} className="mt-1 w-full rounded border border-edge2 bg-panel p-2 disabled:opacity-40" value={negative} onChange={(e) => setNegative(e.target.value)} /></label>
      </div>}
    <p className="mb-3 text-xs text-mid">保留原图，结果放到旁边。开始后可继续编辑画布。</p>
    {(error || (mode === 'grid' && gridError)) && <p role="alert" className="mb-3 text-xs text-rose-500">{error || gridError}</p>}
    <button disabled={busy || (mode === 'grid' && (!!gridError || !dimensions.width))} className="rounded bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void start()}>{busy ? '准备中…' : mode === 'grid' ? '开始裁切' : '开始图生图'}</button>
  </section>, document.body)
}
