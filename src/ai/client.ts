export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>
export interface Binding { node: string; input: string }
export interface Endpoint { url: string; key?: string; model?: string }

export function baseUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写 HTTP(S) 服务地址，不含查询参数、密码或 #')
  }
  return url.href.replace(/\/$/, '')
}

function decode(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

export async function request(url: string, key = '', body?: unknown): Promise<Response> {
  const method = body === undefined ? 'GET' : 'POST'
  const json = body === undefined ? undefined : JSON.stringify(body)
  let response: Response
  if (typeof window !== 'undefined' && window.suqDesktop?.aiRequest) {
    const result = await window.suqDesktop.aiRequest({ url, key, method, body: json })
    response = new Response(decode(result.base64), { status: result.status, headers: { 'Content-Type': result.contentType } })
  } else {
    const target = import.meta.env.DEV ? url.replace(/^http:\/\/127\.0\.0\.1:8188(?=\/|$)/, '/ai-comfy') : url
    try {
      response = await fetch(target, { method, body: json, credentials: 'omit', redirect: 'error',
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(180000) })
    } catch {
      throw new Error('连接失败或超时。请检查地址与服务状态；网页版需要服务允许 CORS，HTTPS 页面不能连接 HTTP 服务。也可使用桌面版。')
    }
  }
  if (!response.ok) throw new Error(`接口错误 ${response.status}：${(await response.text()).slice(0, 1500)}`)
  return response
}

export function parseWorkflow(value: string): Workflow {
  const parsed = JSON.parse(value)
  const workflow = parsed.prompt ?? parsed
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !Object.keys(workflow).length ||
    Object.values(workflow).some((node) => !node || typeof node !== 'object' ||
      typeof (node as Workflow[string]).class_type !== 'string' || !(node as Workflow[string]).inputs)) {
    throw new Error('请选择 ComfyUI 导出的 API 格式 JSON（不是普通画布工作流）')
  }
  return workflow
}

export function textBindings(workflow: Workflow): Binding[] {
  return Object.entries(workflow).flatMap(([node, entry]) => Object.entries(entry.inputs)
    .filter(([input, value]) => typeof value === 'string' && /^(text|text_g|text_l|prompt|positive_prompt|negative_prompt)$/.test(input))
    .map(([input]) => ({ node, input })))
}

export function prepareWorkflow(workflow: Workflow, binding: Binding, prompt: string, randomSeed = true): Workflow {
  const copy = structuredClone(workflow)
  if (!copy[binding.node] || typeof copy[binding.node].inputs[binding.input] !== 'string') throw new Error('请选择有效的提示词输入')
  copy[binding.node].inputs[binding.input] = prompt
  for (const node of Object.values(copy)) {
    for (const input of ['seed', 'noise_seed']) {
      if (randomSeed && typeof node.inputs[input] === 'number') node.inputs[input] = Math.floor(Math.random() * 2 ** 48)
    }
  }
  return copy
}

interface HistoryEntry {
  prompt?: [number, string, Workflow]
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
  status?: { completed?: boolean; status_str?: string; messages?: [string, { exception_message?: string }][] }
}

export async function recentWorkflow(endpoint: Endpoint): Promise<Workflow> {
  const history: Record<string, HistoryEntry> = await (await request(`${baseUrl(endpoint.url)}/history?max_items=20`, endpoint.key)).json()
  const entries = Object.values(history).filter((item) => item.status?.status_str === 'success' && item.prompt)
    .sort((a, b) => (b.prompt?.[0] ?? 0) - (a.prompt?.[0] ?? 0))
  if (!entries.length) throw new Error('没有成功的历史任务，请先在 ComfyUI 生图一次，或导入 API 工作流')
  return parseWorkflow(JSON.stringify(entries[0].prompt![2]))
}

export async function generateComfy(endpoint: Endpoint, workflow: Workflow, binding: Binding, prompt: string,
  signal: AbortSignal, status: (value: string) => void, prepared = false): Promise<Blob[]> {
  signal.throwIfAborted()
  const url = baseUrl(endpoint.url)
  const result = await (await request(`${url}/prompt`, endpoint.key, { prompt: prepareWorkflow(workflow, binding, prompt, !prepared) })).json()
  if (!result.prompt_id || Object.keys(result.node_errors ?? {}).length) throw new Error(`工作流校验失败：${JSON.stringify(result.node_errors ?? result.error)}`)
  const id = result.prompt_id as string
  status(`已提交 ${id}，等待 ComfyUI 生成…`)
  const deadline = Date.now() + 30 * 60 * 1000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const history: Record<string, HistoryEntry> = await (await request(`${url}/history/${encodeURIComponent(id)}`, endpoint.key)).json()
    const entry = history[id]
    if (entry?.status?.status_str === 'error') {
      throw new Error(entry.status.messages?.find(([type]) => type === 'execution_error')?.[1].exception_message || 'ComfyUI 执行失败，请查看服务端日志')
    }
    if (entry?.status?.completed) {
      const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? [])
      if (!images.length) throw new Error('工作流没有返回图片，请添加 SaveImage 输出节点')
      const blobs: Blob[] = []
      for (const image of images) {
        signal.throwIfAborted()
        blobs.push(await (await request(`${url}/view?${new URLSearchParams(image)}`, endpoint.key)).blob())
      }
      return blobs
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`等待超过 30 分钟，请在 ComfyUI 查看任务 ${id}；服务端任务可能仍在运行`)
}

export async function generateCompatible(endpoint: Endpoint, prompt: string, size: string): Promise<Blob[]> {
  if (!endpoint.model?.trim()) throw new Error('请填写生图模型名称')
  const result = await (await request(`${baseUrl(endpoint.url)}/images/generations`, endpoint.key,
    { model: endpoint.model.trim(), prompt, n: 1, size })).json()
  if (!Array.isArray(result.data) || !result.data.length) throw new Error('接口没有返回 data 图片列表；请确认服务支持 Images API')
  return Promise.all(result.data.map(async (item: { b64_json?: string; url?: string }) => {
    if (item.b64_json) return new Blob([decode(item.b64_json)], { type: 'image/png' })
    if (item.url) {
      const imageUrl = new URL(item.url)
      if (!['http:', 'https:'].includes(imageUrl.protocol)) throw new Error('图片地址必须为 HTTP(S)')
      // Signed image URLs must never receive the provider's API key.
      return (await request(imageUrl.href)).blob()
    }
    throw new Error('接口图片缺少 b64_json 或 url')
  }))
}

export async function optimizePrompt(endpoint: Endpoint, prompt: string): Promise<string> {
  if (!endpoint.model?.trim()) throw new Error('请填写提示词优化模型名称')
  const result = await (await request(`${baseUrl(endpoint.url)}/chat/completions`, endpoint.key, {
    model: endpoint.model.trim(), messages: [
      { role: 'system', content: '你是图像提示词编辑。保留用户的主体、文字内容、语言及意图，补充构图、光线、材质等有用细节。不要擅自添加风格，不要解释，只输出一段可直接生图的提示词。' },
      { role: 'user', content: prompt },
    ],
  })).json()
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('优化接口没有返回文本')
  return content.trim()
}
