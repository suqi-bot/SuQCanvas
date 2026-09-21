import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { baseUrl, generateComfy, generateCompatible, optimizePrompt, parseWorkflow, recentWorkflow, request, textBindings, type Workflow } from '../ai/client'
import { useUiStore } from '../store/uiStore'

const STORAGE = 'suqcanvas-ai-settings-v1'
const defaults = { provider: 'comfy', comfyUrl: 'http://127.0.0.1:8188', cloudUrl: '', model: '',
  llmUrl: '', llmModel: '', size: '1024x1024', workflow: '', binding: '' }
function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
      [key, typeof stored[key] === 'string' ? stored[key] : value])) as typeof defaults
  } catch { return defaults }
}
const field = 'w-full rounded-md border border-edge2 bg-panel px-3 py-2 text-sm text-main'
const button = 'rounded-md border border-edge2 px-3 py-2 text-xs text-soft hover:bg-hover disabled:opacity-40'

export function AiImagePanel() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const [comfyKey, setComfyKey] = useState('')
  const [cloudKey, setCloudKey] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [optimized, setOptimized] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ blob: Blob; url: string }[]>([])
  const controller = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const resultRef = useRef(results)
  resultRef.current = results
  useEffect(() => () => {
    controller.current?.abort()
    resultRef.current.forEach((item) => URL.revokeObjectURL(item.url))
  }, [])
  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])
  function update(key: keyof typeof defaults, value: string) {
    setSettings((previous) => ({ ...previous, [key]: value }))
  }
  let workflow: Workflow | null = null
  try { if (settings.workflow) workflow = parseWorkflow(settings.workflow) } catch { /* Shown on generation. */ }
  const bindings = workflow ? textBindings(workflow) : []
  function acceptWorkflow(value: Workflow) {
    const choices = textBindings(value)
    const selected = choices.find((item) => !/negative/i.test(`${item.input} ${value[item.node]._meta?.title}`)) ?? choices[0]
    setSettings((previous) => ({ ...previous, workflow: JSON.stringify(value), binding: selected ? JSON.stringify(selected) : '' }))
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setMessage('处理中…')
    try { await action() } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setMessage('')
    } finally { setBusy(false); controller.current = null }
  }
  function close() { setOpen(false); trigger.current?.focus() }
  return <>
    <button ref={trigger} type="button" className={button + ' shrink-0'} onClick={() => setOpen(true)}>✦ AI 生图</button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby="ai-title"
      className="fixed inset-0 m-auto max-h-[90vh] w-[760px] max-w-[95vw] overflow-y-auto rounded-xl border border-edge2 bg-panel p-6 text-main shadow-2xl backdrop:bg-black/60"
      onCancel={(event) => { event.preventDefault(); if (!busy) close() }}
      onKeyDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h2 id="ai-title" className="text-lg font-semibold">AI 生图</h2>
        <button type="button" className={button} disabled={busy} onClick={close}>关闭</button></div>
      <p className="mb-4 text-xs text-mid">连接自己的生图服务，预览满意后加入画布。API Key 仅在本次打开应用期间保留，不写入项目。</p>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
        <label className="block text-xs">生图服务<select className={field + ' mt-1'} value={settings.provider} onChange={(e) => update('provider', e.target.value)}>
          <option value="comfy">ComfyUI（本地 / 远程）</option><option value="compatible">OpenAI 兼容 Images API</option>
        </select></label>
        {settings.provider === 'comfy' ? <>
          <label className="block text-xs">ComfyUI 地址<input className={field + ' mt-1'} value={settings.comfyUrl} onChange={(e) => update('comfyUrl', e.target.value)} /></label>
          <label className="block text-xs">API Key（本地通常留空）<input type="password" autoComplete="off" className={field + ' mt-1'} value={comfyKey} onChange={(e) => setComfyKey(e.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => void run(async () => {
              const stats = await (await request(`${baseUrl(settings.comfyUrl)}/system_stats`, comfyKey)).json()
              if (!stats.system) throw new Error('此地址不是 ComfyUI 服务')
              setMessage(`连接成功 · ComfyUI ${stats.system.comfyui_version || ''}`)
            })}>测试连接</button>
            <button className={button} onClick={() => void run(async () => {
              acceptWorkflow(await recentWorkflow({ url: settings.comfyUrl, key: comfyKey }))
              setMessage('已载入最近成功的工作流，请核对提示词输入节点。尺寸、步数及模型沿用工作流，种子每次随机。')
            })}>读取最近成功工作流</button>
            <label className={button + ' cursor-pointer'}>导入 API 工作流<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0]; e.target.value = ''
              if (file) void run(async () => { acceptWorkflow(parseWorkflow(await file.text())); setMessage('工作流已导入，请选择提示词输入节点。') })
            }} /></label>
          </div>
          {workflow && <label className="block text-xs">替换哪个提示词输入（其余节点保留）<select className={field + ' mt-1'} value={settings.binding} onChange={(e) => update('binding', e.target.value)}>
            <option value="">请选择</option>{bindings.map((item) => <option key={JSON.stringify(item)} value={JSON.stringify(item)}>
              {item.node} · {workflow![item.node]._meta?.title || workflow![item.node].class_type} · {item.input}
            </option>)}
          </select></label>}
          <p className="text-xs text-mid">先在 ComfyUI 跑通工作流，再读取或导入。沿用模型、尺寸、负面词及采样参数。网页版连接其他地址需服务允许跨域；127.0.0.1 指当前设备。</p>
        </> : <>
          <label className="block text-xs">API Base URL（通常以 /v1 结尾）<input className={field + ' mt-1'} placeholder="https://你的服务地址/v1" value={settings.cloudUrl} onChange={(e) => update('cloudUrl', e.target.value)} /></label>
          <label className="block text-xs">API Key<input type="password" autoComplete="off" className={field + ' mt-1'} value={cloudKey} onChange={(e) => setCloudKey(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs">模型名称<input className={field + ' mt-1'} value={settings.model} onChange={(e) => update('model', e.target.value)} /></label>
            <label className="text-xs">图片尺寸<input className={field + ' mt-1'} placeholder="1024x1024 或 auto" value={settings.size} onChange={(e) => update('size', e.target.value)} /></label></div>
          <p className="text-xs text-mid">服务需支持 /images/generations，并返回 b64_json 或图片 URL；模型及尺寸请按服务商填写。</p>
        </>}
        <label className="block text-xs">描述你想生成的画面<textarea autoFocus className={field + ' mt-1 min-h-28 resize-y'} placeholder="例如：雨后的中国小城街道，傍晚暖光，胶片摄影质感…" value={prompt} onChange={(e) => { setPrompt(e.target.value); setOptimized('') }} /></label>
        <details className="rounded-md border border-edge2 p-3"><summary className="cursor-pointer text-sm">可选：AI 提示词优化</summary>
          <p className="my-3 text-xs text-mid">不需要额外 AI 也能生图。需要扩写描述时，可单独连接本地或云端文字模型；先预览，再决定是否采用。</p>
          <div className="space-y-3">
            <label className="block text-xs">文字模型 Base URL<input className={field + ' mt-1'} placeholder="http://127.0.0.1:11434/v1" value={settings.llmUrl} onChange={(e) => update('llmUrl', e.target.value)} /></label>
            <label className="block text-xs">文字模型 API Key（可留空）<input className={field + ' mt-1'} type="password" autoComplete="off" value={llmKey} onChange={(e) => setLlmKey(e.target.value)} /></label>
            <label className="block text-xs">文字模型名称<input className={field + ' mt-1'} value={settings.llmModel} onChange={(e) => update('llmModel', e.target.value)} /></label>
            <button className={button} disabled={!prompt.trim()} onClick={() => void run(async () => {
              setOptimized(await optimizePrompt({ url: settings.llmUrl, key: llmKey, model: settings.llmModel }, prompt)); setMessage('优化完成，采用后才会替换原提示词。')
            })}>优化提示词</button>
            {optimized && <div><p className="mb-2 whitespace-pre-wrap text-sm">{optimized}</p><button className={button} onClick={() => { setPrompt(optimized); setOptimized('') }}>采用此提示词</button></div>}
          </div>
        </details>
        <div className="flex gap-2">
          <button className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-40" disabled={!prompt.trim()} onClick={() => void run(async () => {
            const abort = new AbortController(); controller.current = abort
            const blobs = settings.provider === 'comfy'
              ? await generateComfy({ url: settings.comfyUrl, key: comfyKey }, parseWorkflow(settings.workflow || '{}'), JSON.parse(settings.binding || '{}'), prompt, abort.signal, setMessage)
              : await generateCompatible({ url: settings.cloudUrl, key: cloudKey, model: settings.model }, prompt, settings.size)
            abort.signal.throwIfAborted()
            for (const blob of blobs) {
              const bitmap = await createImageBitmap(blob); bitmap.close()
            }
            resultRef.current.forEach((item) => URL.revokeObjectURL(item.url))
            setResults(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
            setMessage(`已生成 ${blobs.length} 张图片，可预览并加入画布。`)
          })}>生成图片</button>
          <button className={button} onClick={() => {
            try { localStorage.setItem(STORAGE, JSON.stringify(settings)); setMessage('服务地址、模型和工作流已保存在当前设备（不含 API Key）。'); setError('') }
            catch { setError('保存配置失败，浏览器存储可能已满。') }
          }}>保存配置</button>
        </div>
      </fieldset>
      {busy && controller.current && <button className={button + ' mt-3'} onClick={() => {
        controller.current?.abort(new Error('已停止等待。服务端任务可能仍在运行，请在服务端查看结果。'))
        setMessage('正在停止等待；不会中断服务端其他人的任务…')
      }}>停止等待</button>}
      <p role="status" className="mt-3 break-words text-xs text-mid">{message}</p>
      {error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm text-rose-500">{error}</p>}
      {!!results.length && <div className="mt-4 grid grid-cols-2 gap-4">{results.map((item, index) => <div key={item.url} className="rounded-lg border border-edge2 p-2">
        <img src={item.url} alt={`AI 生成结果 ${index + 1}`} className="max-h-72 w-full rounded object-contain" />
        <button className={button + ' mt-2 w-full'} disabled={busy} onClick={() => {
          const extension = item.blob.type === 'image/jpeg' ? 'jpg' : item.blob.type === 'image/webp' ? 'webp' : 'png'
          useUiStore.getState().requestImport([new File([item.blob], `AI-${Date.now()}-${index + 1}.${extension}`, { type: item.blob.type || 'image/png' })], true)
          close()
        }}>加入当前画布</button>
      </div>)}</div>}
    </dialog>, document.body)}
  </>
}
