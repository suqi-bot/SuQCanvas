import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { baseUrl, comfyObjectInfo, comfyParamSpec, parseWorkflow, recentWorkflow, request, textBindings, type ComfyObjectInfo, type Workflow } from '../ai/client'
import { useAiStore, saveAiSettings, type AiSettings } from '../ai/store'
import { SplitWorkflowSettings } from './SplitWorkflowSettings'

const field = 'w-full rounded-md border border-edge2 bg-panel px-3 py-2 text-sm text-main'
const button = 'rounded-md border border-edge2 px-3 py-2 text-xs text-soft hover:bg-hover disabled:opacity-40'

export function AiImagePanel() {
  const { settings, comfyKey, cloudKey, llmKey, settingsOpen: open, setSettings, setCredentials, setSettingsOpen } = useAiStore()
  const randomSeed = settings.randomSeed
  const setRandomSeed = (randomSeed: boolean) => setSettings({ randomSeed })
  const setComfyKey = (comfyKey: string) => setCredentials({ comfyKey })
  const setCloudKey = (cloudKey: string) => setCredentials({ cloudKey })
  const setLlmKey = (llmKey: string) => setCredentials({ llmKey })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [objectInfo, setObjectInfo] = useState<ComfyObjectInfo | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  async function loadObjectInfo() {
    try { setObjectInfo(await comfyObjectInfo({ url: settings.comfyUrl, key: comfyKey })) }
    catch { setObjectInfo(null) }
  }
  useEffect(() => {
    if (open && settings.provider === 'comfy') void loadObjectInfo()
    // 打开设置时自动读取一次；地址变更后可点「刷新可选项」重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.provider])
  function update(key: keyof AiSettings, value: string) { setSettings({ [key]: value }) }
  let workflow: Workflow | null = null
  try { if (settings.workflow) workflow = parseWorkflow(settings.workflow) } catch { /* Validated before generation. */ }
  const bindings = workflow ? textBindings(workflow) : []
  function acceptWorkflow(value: Workflow) {
    const choices = textBindings(value)
    const selected = choices.find((item) => !/negative/i.test(item.input + ' ' + value[item.node]._meta?.title)) ?? choices[0]
    const negative = choices.find((item) => /negative|负向|反向/i.test(item.input + ' ' + value[item.node]._meta?.title))
    setSettings({ workflow: JSON.stringify(value), binding: selected ? JSON.stringify(selected) : '',
      negativeBinding: negative ? JSON.stringify(negative) : '', negativePrompt: negative ? String(value[negative.node].inputs[negative.input]) : '' })
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setMessage('处理中…')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setMessage('') }
    finally { setBusy(false) }
  }
  function close() { setSettingsOpen(false); trigger.current?.focus() }
  return <>
    <button ref={trigger} type="button" className={button + ' shrink-0'} onClick={() => setSettingsOpen(true)}>✦ AI 生图设置</button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby="ai-title"
      className="fixed inset-0 m-auto max-h-[90vh] w-[760px] max-w-[95vw] overflow-y-auto rounded-xl border border-edge2 bg-panel p-6 text-main shadow-2xl backdrop:bg-black/60"
      onCancel={(event) => { event.preventDefault(); close() }} onKeyDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h2 id="ai-title" className="text-lg font-semibold">AI 生图设置</h2>
        <button type="button" className={button} onClick={close}>关闭</button></div>
      <p className="mb-4 text-xs text-mid">配置生图服务、参数和提示词优化模型。通过「插入 → AI 图片」在画布中输入需求、发送生成。关闭设置不会停止后台生成。API Key 保存在本机独立凭据中，重启后会自动恢复。</p>
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
          {workflow && <label className="block text-xs">反向提示词输入<select className={field + ' mt-1'} value={settings.negativeBinding} onChange={(e) => update('negativeBinding', e.target.value)}>
            <option value="">不替换，保留工作流原值</option>{bindings.map((item) => <option key={JSON.stringify(item)} value={JSON.stringify(item)} disabled={JSON.stringify(item) === settings.binding}>
              {item.node} · {workflow![item.node]._meta?.title || workflow![item.node].class_type} · {item.input}
            </option>)}
          </select></label>}
          {workflow && <details className="rounded-md border border-edge2 p-3"><summary className="cursor-pointer text-sm">生成参数（模型、尺寸、步数、种子等）</summary>
            <label className="my-3 flex gap-2 text-xs"><input type="checkbox" checked={randomSeed} onChange={(e) => setRandomSeed(e.target.checked)} />每次随机种子（关闭后使用下方种子）</label>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-mid">
              <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
                await loadObjectInfo(); setMessage('已刷新参数下拉可选项。')
              })}>刷新可选项</button>
              {!objectInfo && <span>未能读取服务端可选项，枚举参数暂为手输；可点「刷新可选项」重试。</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">{Object.entries(workflow).flatMap(([nodeId, node]) => Object.entries(node.inputs)
              .filter(([input, value]) => ['number', 'string', 'boolean'].includes(typeof value) && JSON.stringify({ node: nodeId, input }) !== settings.binding && JSON.stringify({ node: nodeId, input }) !== settings.negativeBinding)
              .map(([input, value]) => {
                const spec = comfyParamSpec(objectInfo, node.class_type, input)
                const options = spec?.options?.map(String)
                const current = String(value)
                const control = options
                  ? <select className={field + ' mt-1'} aria-label={`${nodeId}.${input}`} value={current}
                      onChange={(e) => {
                        const copy = structuredClone(workflow!)
                        copy[nodeId].inputs[input] = typeof value === 'number' ? Number(e.target.value) : e.target.value
                        update('workflow', JSON.stringify(copy))
                      }}>
                      {!options.includes(current) && <option value={current}>{current}</option>}
                      {options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  : typeof value === 'boolean'
                    ? <input className="mt-1 block" type="checkbox" checked={value}
                        onChange={(e) => {
                          const copy = structuredClone(workflow!)
                          copy[nodeId].inputs[input] = e.target.checked
                          update('workflow', JSON.stringify(copy))
                        }} />
                    : typeof value === 'number'
                      ? <input className={field + ' mt-1'} type="number"
                          min={spec?.min} max={spec?.max} step={spec?.step ?? (Number.isInteger(value) ? 1 : 'any')}
                          value={value}
                          onChange={(e) => {
                            const copy = structuredClone(workflow!)
                            copy[nodeId].inputs[input] = Number(e.target.value)
                            update('workflow', JSON.stringify(copy))
                          }} />
                      : <input className={field + ' mt-1'} type="text" value={String(value)}
                          onChange={(e) => {
                            const copy = structuredClone(workflow!)
                            copy[nodeId].inputs[input] = e.target.value
                            update('workflow', JSON.stringify(copy))
                          }} />
                return <label key={`${nodeId}.${input}`} className="text-xs">{node._meta?.title || node.class_type} · {nodeId} · {input}
                  {control}
                </label>
              }))}</div>
          </details>}
          <p className="text-xs text-mid">先在 ComfyUI 跑通工作流，再读取或导入。可展开生成参数调整模型、尺寸、负面词及采样参数。网页版连接其他地址需服务允许跨域；127.0.0.1 指当前设备。</p>
        </> : <>
          <label className="block text-xs">API Base URL（通常以 /v1 结尾）<input className={field + ' mt-1'} placeholder="https://你的服务地址/v1" value={settings.cloudUrl} onChange={(e) => update('cloudUrl', e.target.value)} /></label>
          <label className="block text-xs">API Key<input type="password" autoComplete="off" className={field + ' mt-1'} value={cloudKey} onChange={(e) => setCloudKey(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs">模型名称<input className={field + ' mt-1'} value={settings.model} onChange={(e) => update('model', e.target.value)} /></label>
            <label className="text-xs">图片尺寸<input className={field + ' mt-1'} placeholder="1024x1024 或 auto" value={settings.size} onChange={(e) => update('size', e.target.value)} /></label></div>
          <p className="text-xs text-mid">服务需支持 /images/generations（文生图），图生图另用 /images/edits；返回 b64_json 或图片 URL。模型及尺寸请按服务商填写。</p>
        </>}
        <label className="block text-xs">默认反向提示词<textarea className={field + ' mt-1'} value={settings.negativePrompt} onChange={(e) => update('negativePrompt', e.target.value)} placeholder="不希望出现的内容，例如：模糊、水印" /></label>
        {settings.provider === 'compatible' && <p className="text-xs text-mid">填写反向提示词时会发送 negative_prompt 扩展字段，需要你的服务支持；不支持时请留空。</p>}
        <SplitWorkflowSettings />
        <details className="rounded-md border border-edge2 p-3"><summary className="cursor-pointer text-sm">可选：AI 提示词优化</summary>
          <p className="my-3 text-xs text-mid">不需要额外 AI 也能生图。需要扩写描述时，可单独连接本地或云端文字模型；先预览，再决定是否采用。</p>
          <div className="space-y-3">
            <label className="block text-xs">文字模型 Base URL<input className={field + ' mt-1'} placeholder="http://127.0.0.1:11434/v1" value={settings.llmUrl} onChange={(e) => update('llmUrl', e.target.value)} /></label>
            <label className="block text-xs">文字模型 API Key（可留空）<input className={field + ' mt-1'} type="password" autoComplete="off" value={llmKey} onChange={(e) => setLlmKey(e.target.value)} /></label>
            <label className="block text-xs">文字模型名称<input className={field + ' mt-1'} value={settings.llmModel} onChange={(e) => update('llmModel', e.target.value)} /></label>
          </div>
        </details>

        <button className={button} onClick={() => {
          try { saveAiSettings(); setMessage('配置与 API Key 已保存到本机。'); setError('') }
          catch { setError('保存配置失败，浏览器存储可能已满。') }
        }}>保存配置</button>
      </fieldset>
      <p role="status" className="mt-3 break-words text-xs text-mid">{message}</p>
      {error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm text-rose-500">{error}</p>}
    </dialog>, document.body)}
  </>
}
