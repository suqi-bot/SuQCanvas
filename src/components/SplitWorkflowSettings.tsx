import { useState } from 'react'
import { parseWorkflow, textBindings, type Workflow } from '../ai/client'
import { useAiStore } from '../ai/store'

export function SplitWorkflowSettings() {
  const { settings, setSettings, cloudKey, setCredentials } = useAiStore()
  const [error, setError] = useState('')
  const splitProvider = settings.splitProvider
  const cloudApiFields = <>
    <label className="mb-3 block text-xs">API Base URL
      <input className="mt-1 w-full rounded border border-edge2 bg-panel p-2"
        placeholder={splitProvider === 'dashscope' ? 'https://maas.example.com/compatible-mode/v1 或 …/api/v1' : 'https://你的服务地址/v1'}
        value={settings.splitCloudUrl || settings.cloudUrl} onChange={(e) => setSettings({ splitCloudUrl: e.target.value })} />
    </label>
    <label className="mb-3 block text-xs">API Key
      <input type="password" autoComplete="off" className="mt-1 w-full rounded border border-edge2 bg-panel p-2"
        value={cloudKey} onChange={(e) => setCredentials({ cloudKey: e.target.value })} />
    </label>
    <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
      <label className="block">模型名称
        <input className="mt-1 w-full rounded border border-edge2 bg-panel p-2"
          placeholder={splitProvider === 'dashscope' ? '如 qwen-image-3.0' : '图像编辑/图生图模型'}
          value={settings.splitModel || settings.model} onChange={(e) => setSettings({ splitModel: e.target.value })} />
      </label>
      <label className="block">输出张数（1–4）
        <input type="number" min={1} max={4} step={1} className="mt-1 w-full rounded border border-edge2 bg-panel p-2"
          value={settings.splitCount} onChange={(e) => setSettings({ splitCount: Number(e.target.value) })} />
      </label>
    </div>
  </>
  let workflow: Workflow | undefined
  try { if (settings.splitWorkflow) workflow = parseWorkflow(settings.splitWorkflow) } catch { /* validated on import */ }
  const images = workflow ? Object.entries(workflow).flatMap(([node, entry]) => Object.entries(entry.inputs)
    .filter(([input, value]) => typeof value === 'string' && input === 'image').map(([input]) => ({ node, input }))) : []
  const texts = workflow ? textBindings(workflow) : []
  return <details className="rounded-md border border-edge2 p-3" open={splitProvider !== 'comfy'}>
    <summary className="cursor-pointer text-sm">图生图调用方式</summary>
    <p className="my-3 text-xs text-mid">可选 ComfyUI 分层、OpenAI <code>/images/edits</code>，或千问 DashScope <code>multimodal-generation</code>。API Key 与生图共用本机凭据，输入后自动保存。</p>
    <label className="mb-3 block text-xs">调用方式<select className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={splitProvider}
      onChange={(e) => setSettings({ splitProvider: e.target.value })}>
      <option value="comfy">ComfyUI 工作流（分层图生图）</option>
      <option value="compatible">OpenAI 兼容（/images/edits）</option>
      <option value="dashscope">千问 / DashScope（图生图 API）</option>
    </select></label>
    {splitProvider === 'dashscope' ? <>
      {cloudApiFields}
      <p className="text-xs text-mid">请求 <code>POST …/api/v1/services/aigc/multimodal-generation/generation</code>，JSON 内嵌原图 data URL 与提示词；返回图作为独立图层加入画布。Base URL 可填 <code>…/compatible-mode/v1</code> 或 <code>…/api/v1</code>，会自动补全路径。</p>
    </> : splitProvider === 'compatible' ? <>
      {cloudApiFields}
      <p className="text-xs text-mid">调用 <code>POST {"{Base URL}"}/images/edits</code>，multipart 上传原图 + prompt；返回的每张图作为独立图层加入画布。</p>
    </> : <>
      <label className="mb-3 block text-xs">ComfyUI 地址
        <input className="mt-1 w-full rounded border border-edge2 bg-panel p-2" value={settings.comfyUrl} onChange={(e) => setSettings({ comfyUrl: e.target.value })} />
      </label>
      <input type="file" accept=".json,application/json" aria-label="导入图生图 API 工作流" onChange={async (e) => {
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
      <p className="mt-3 text-xs text-mid">导入已跑通的分层/分割 API 工作流，将主体、背景等接到图片输出节点；透明度由工作流决定。</p>
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
  </details>
}
