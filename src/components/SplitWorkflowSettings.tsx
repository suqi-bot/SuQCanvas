import { useState } from 'react'
import { parseWorkflow, textBindings, type Workflow } from '../ai/client'
import { useAiStore } from '../ai/store'

export function SplitWorkflowSettings() {
  const { settings, setSettings, comfyKey, setCredentials } = useAiStore()
  const [error, setError] = useState('')
  let workflow: Workflow | undefined
  try { if (settings.splitWorkflow) workflow = parseWorkflow(settings.splitWorkflow) } catch { /* validated on import */ }
  const images = workflow ? Object.entries(workflow).flatMap(([node, entry]) => Object.entries(entry.inputs)
    .filter(([input, value]) => typeof value === 'string' && input === 'image').map(([input]) => ({ node, input }))) : []
  const texts = workflow ? textBindings(workflow) : []
  return <details className="rounded-md border border-edge2 p-3"><summary className="cursor-pointer text-sm">AI 拆图工作流</summary>
    <p className="my-3 text-xs text-mid">使用 ComfyUI 地址与 API Key。请导入已跑通的分层或分割 API 工作流，将主体、背景等图层接到图片输出节点；透明度由工作流输出决定。</p>
    <label className="mb-3 block text-xs">ComfyUI 地址<input className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={settings.comfyUrl} onChange={(e) => setSettings({ comfyUrl: e.target.value })} /></label>
    <label className="mb-3 block text-xs">ComfyUI API Key（可留空）<input type="password" autoComplete="off" className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={comfyKey} onChange={(e) => setCredentials({ comfyKey: e.target.value })} /></label>
    <input type="file" accept=".json,application/json" aria-label="导入拆图 API 工作流" onChange={async (e) => {
      const file = e.target.files?.[0]; e.target.value = ''
      if (!file) return
      try {
        const value = parseWorkflow(await file.text())
        const image = Object.entries(value).find(([, n]) => typeof n.inputs.image === 'string')
        setSettings({ splitWorkflow: JSON.stringify(value), splitImageBinding: image ? JSON.stringify({ node: image[0], input: 'image' }) : '', splitPromptBinding: '', splitNegativeBinding: '' })
        setError('')
      } catch (reason) { setError(String(reason)) }
    }} />
    {workflow && ([['splitImageBinding', '原图输入', images], ['splitPromptBinding', '正向提示词（可选）', texts], ['splitNegativeBinding', '反向提示词（可选）', texts]] as const).map(([key, label, choices]) =>
      <label key={key} className="mt-3 block text-xs">{label}<select className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={settings[key]} onChange={(e) => setSettings({ [key]: e.target.value })}>
        <option value="">请选择</option>{choices.map((b) => <option key={JSON.stringify(b)} value={JSON.stringify(b)}>{b.node} · {workflow![b.node]._meta?.title || workflow![b.node].class_type} · {b.input}</option>)}
      </select></label>)}
    {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
  </details>
}
