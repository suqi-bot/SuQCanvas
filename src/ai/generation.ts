import { baseUrl, editCompatibleImage, editDashscopeImage, generateComfy, generateCompatible, parseWorkflow, prepareWorkflow, uploadComfyImage, waitForComfy, type Binding } from './client'
import { abortable } from './abort'
import { splitGrid } from './gridSplit'
import { useAiStore, type AiSettings } from './store'
import { aiJobKey, type AiTask } from './taskTypes'
import { db } from '../db/db'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useAuthStore } from '../store/authStore'
import { toast } from '../store/uiStore'
import { createNodeForAsset, putAsset } from '../io/fileLoader'
import { isNodeLockedByOther } from '../sync/lanClient'
import { genUuid } from '../utils/uuid'
import type { SuqNode, SuqNodeData } from '../types'

const controllers = new Map<string, AbortController>()
const applying = new Set<string>()
const executions = new Set<Promise<void>>()
export const aiOwner = () => useAuthStore.getState().user?.id ?? 'local'
const jobKey = (task: AiTask) => aiJobKey(task.projectId, task.nodeId)
function reflect(task: AiTask) {
  const newer = useAiStore.getState().tasks.some((t) => jobKey(t) === jobKey(task) && t.createdAt > task.createdAt)
  useAiStore.getState().setTask(task)
  if (newer) return
  useAiStore.getState().setJob(jobKey(task), { running: task.state === 'running', message: task.message,
    error: task.state === 'error' ? task.message : undefined })
}
async function persist(task: AiTask) {
  task.updatedAt = Date.now()
  await db.aiTasks.put(task)
  reflect(task)
}
export function stopAiGeneration(nodeId: string, projectId = useProjectStore.getState().projectId) {
  controllers.get(aiJobKey(projectId, nodeId))?.abort(new Error('已停止等待，服务端任务可能仍在运行。'))
}
export function hasRunningAiTasks() { return controllers.size > 0 }
export async function prepareAiExit() {
  for (const controller of controllers.values()) controller.abort(new Error('应用已退出，可在 AI 任务中恢复等待'))
  await Promise.allSettled([...executions])
}
async function launch(task: AiTask, abort: AbortController, key: string, resume = false) {
  const promise = execute(task, abort, key, resume)
  executions.add(promise)
  try { await promise } finally { executions.delete(promise) }
}
export function generationSettings(ai: NonNullable<SuqNodeData['ai']>, settings: AiSettings): AiSettings {
  if (ai.parameterSource !== 'original' || !ai.provider) return { ...settings }
  return { ...settings, provider: ai.provider, model: ai.model, size: ai.size, workflow: ai.workflow,
    binding: ai.binding, negativeBinding: ai.negativeBinding ?? '', negativePrompt: ai.negativePrompt ?? '', randomSeed: false,
    comfyUrl: ai.provider === 'comfy' ? ai.serviceUrl || settings.comfyUrl : settings.comfyUrl,
    cloudUrl: ai.provider === 'compatible' ? ai.serviceUrl || settings.cloudUrl : settings.cloudUrl }
}
function resultGraph(nodes: SuqNode[], task: AiTask): SuqNode[] | null {
  const node = nodes.find((n) => n.id === task.nodeId)
  if (!node || !task.resultNodes?.length) return null
  if (node.data.ai?.generationId === task.id || node.data.splitTaskId === task.id) return nodes
  if ((node.data.ai?.generatedAt ?? 0) > task.createdAt) return null
  const [first, ...rest] = task.resultNodes
  return [...nodes.map((n) => n.id === node.id ? { ...n, data: { ...n.data, ...first.data,
    ai: first.data.ai ? { ...first.data.ai, draftPrompt: n.data.ai?.draftPrompt, draftNegativePrompt: n.data.ai?.draftNegativePrompt, parameterSource: n.data.ai?.parameterSource } : undefined } } : n),
    ...rest.filter((r) => !nodes.some((n) => n.id === r.id)).map((r, index) => ({ ...r, parentId: node.parentId,
      position: { x: node.position.x + (task.grid ? (index + 1) % task.grid.columns : index + 1) * 520,
        y: node.position.y + (task.grid ? Math.floor((index + 1) / task.grid.columns) * 400 : 0) } }))]
}

/** Results are durable before application; never recreate a deleted project or node. */
export async function applyAiTask(taskId: string): Promise<void> {
  if (applying.has(taskId)) return
  applying.add(taskId)
  try {
    let task = await db.aiTasks.get(taskId)
    if (!task || task.state !== 'ready' || task.owner !== aiOwner()) return
    // 图生图：结果存为预览资源，写入 editPreviewAssetId 供画布对比，不直接替换原图
    if (task.info.genMode === 'edit') {
      if (!task.previewAssetId) {
        const blob = task.blobs?.[0]
        if (!blob) throw new Error('图生图没有返回图片')
        const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
        const asset = await putAsset(new File([blob], `AI-edit-${task.id}.${ext}`, { type: blob.type || 'image/png' }))
        task = { ...task, previewAssetId: asset.id, blobs: undefined }
        await persist(task)
      }
      const project = useProjectStore.getState()
      const current = task
      if (project.busy || !project.initialized || current.owner !== aiOwner()) return
      if (project.projectId === current.projectId) {
        if (isNodeLockedByOther(current.nodeId)) return
        const node = useCanvasStore.getState().nodes.find((n) => n.id === current.nodeId)
        if (node?.data.ai) {
          useCanvasStore.getState().updateNodeData(current.nodeId, {
            ai: { ...node.data.ai, editPreviewAssetId: current.previewAssetId, generationId: current.id, status: 'done', generatedAt: current.updatedAt },
          })
          await project.saveNow()
          if (useProjectStore.getState().saveStatus === 'error') throw new Error('预览已保留，但项目保存失败，请重试应用')
          task = { ...current, state: 'done', message: '图生图完成，拖动对比线查看，点击「应用」替换原图' }
          await persist(task)
        } else {
          task = { ...current, state: 'done', message: '原节点已删除，图生图结果未应用' }
          await persist(task)
        }
        return
      }
      if (current.owner === 'local') {
        let applied = false
        await db.transaction('rw', db.projects, async () => {
          const record = await db.projects.get(current.projectId)
          if (!record || useProjectStore.getState().busy || useProjectStore.getState().projectId === current.projectId || aiOwner() !== current.owner) return
          const nodes = record.graph.nodes.map((n) => n.id === current.nodeId && n.data.ai
            ? { ...n, data: { ...n.data, ai: { ...n.data.ai, editPreviewAssetId: current.previewAssetId, generationId: current.id, status: 'done' as const, generatedAt: current.updatedAt } } }
            : n)
          if (!nodes.some((n) => n.id === current.nodeId && n.data.ai)) return
          await db.projects.update(record.id, { graph: { ...record.graph, nodes }, updatedAt: Date.now() })
          applied = true
        })
        if (!applied) return
        task = { ...current, state: 'done', message: '图生图完成，打开原项目后对比应用' }
        await persist(task)
        return
      }
      task.message = '结果已保留，打开原在线项目后对比应用'
      await persist(task)
      return
    }
    if (!task.resultNodes) {
      const nodes: SuqNode[] = []
      for (const [index, blob] of (task.blobs ?? []).entries()) {
        if (task.owner !== aiOwner()) return
        const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
        const asset = await putAsset(new File([blob], `AI-${task.id}-${index + 1}.${ext}`, { type: blob.type || 'image/png' }))
        const node = createNodeForAsset(asset, { x: 0, y: 0 })
        node.id = `ai-${task.id}-${index}`
        node.data.ai = task.grid ? undefined : { ...task.info, generationId: task.id, status: 'done', generatedAt: task.updatedAt }
        if (task.grid) node.data.splitTaskId = task.id
        nodes.push(node)
      }
      if (!nodes.length) throw new Error('任务没有可用图片')
      task = { ...task, resultNodes: nodes }
      await persist(task)
    }
    const project = useProjectStore.getState()
    if (project.busy || !project.initialized || task.owner !== aiOwner()) return
    if (project.projectId === task.projectId) {
      if (isNodeLockedByOther(task.nodeId)) return
      const nodes = resultGraph(useCanvasStore.getState().nodes, task)
      if (!nodes) { task.message = '图片已保留，原节点已删除或已有更新结果，可在任务列表下载'; await persist(task); return }
      if (nodes !== useCanvasStore.getState().nodes) {
        useCanvasStore.getState().updateNodeData(task.nodeId, nodes.find((n) => n.id === task!.nodeId)!.data)
        const ids = new Set(useCanvasStore.getState().nodes.map((n) => n.id))
        const extras = nodes.filter((n) => !ids.has(n.id))
        if (extras.length) useCanvasStore.getState().addNodes(extras)
      }
      await project.saveNow()
      if (useProjectStore.getState().saveStatus === 'error') throw new Error('图片已保留，但项目保存失败，请重试写入')
    } else if (task.owner === 'local') {
      let applied = false
      await db.transaction('rw', db.projects, async () => {
        const record = await db.projects.get(task!.projectId)
        if (!record || useProjectStore.getState().busy || useProjectStore.getState().projectId === task!.projectId || aiOwner() !== task!.owner) return
        const nodes = resultGraph(record.graph.nodes, task!)
        if (!nodes) return
        await db.projects.update(record.id, { graph: { ...record.graph, nodes }, updatedAt: Date.now() })
        applied = true
      })
      if (!applied) { task.message = '结果已保留，打开原项目后写入，或下载图片'; await persist(task); return }
    } else {
      task.message = '结果已保留，打开原在线项目后写入'
      await persist(task)
      return
    }
    task.state = 'done'; task.message = `已保存到「${task.projectName}」`; task.blobs = undefined
    await persist(task)
  } catch (reason) {
    const task = await db.aiTasks.get(taskId)
    if (task) { task.message = reason instanceof Error ? reason.message : String(reason); await persist(task) }
  } finally { applying.delete(taskId) }
}
async function execute(task: AiTask, abort: AbortController, key: string, resume = false) {
  const activeKey = jobKey(task)
  const progress = (message: string) => {
    if (!abort.signal.aborted) useAiStore.getState().setJob(activeKey, { running: true, message })
  }
  try {
    await persist(task)
    abort.signal.throwIfAborted()
    const endpoint = { url: task.serviceUrl, key, model: task.info.model }
    if (!resume && task.sourceBlob && task.info.imageBinding && task.info.provider === 'comfy') {
      progress('正在上传图生图原图…')
      const workflow = parseWorkflow(task.info.workflow)
      const binding: Binding = JSON.parse(task.info.imageBinding)
      if (typeof workflow[binding.node]?.inputs[binding.input] !== 'string') throw new Error('图生图工作流的图片输入无效')
      workflow[binding.node].inputs[binding.input] = await uploadComfyImage(endpoint, task.sourceBlob, abort.signal)
      task.info.workflow = JSON.stringify(workflow)
      await persist(task)
    }
    const work = task.grid && task.sourceBlob ? splitGrid(task.sourceBlob, task.grid.rows, task.grid.columns, task.grid.gap, task.grid.margin, abort.signal)
      : resume ? waitForComfy(endpoint, task.promptId!, abort.signal, progress)
      : task.info.provider === 'comfy'
        ? generateComfy(endpoint, parseWorkflow(task.info.workflow), JSON.parse(task.info.binding || '{}'), task.info.prompt,
          abort.signal, progress, true, async (promptId) => { task.promptId = promptId; task.sourceBlob = undefined; await persist(task) })
        : task.sourceBlob
          ? (progress('正在调用图生图接口…'),
            task.info.apiStyle === 'dashscope'
              ? editDashscopeImage(endpoint, task.sourceBlob, task.info.prompt, abort.signal, {
                n: task.info.splitCount, negativePrompt: task.info.negativePrompt })
              : editCompatibleImage(endpoint, task.sourceBlob, task.info.prompt, abort.signal, {
                n: task.info.splitCount, size: task.info.size, negativePrompt: task.info.negativePrompt }))
          : generateCompatible(endpoint, task.info.prompt, task.info.size, abort.signal, task.info.negativePrompt)
    const blobs = await abortable(work, abort.signal)
    abort.signal.throwIfAborted()
    for (const blob of blobs) { const bitmap = await createImageBitmap(blob); bitmap.close() }
    abort.signal.throwIfAborted()
    const wasImageEdit = task.info.provider === 'compatible' && !!task.sourceBlob
    task.blobs = blobs; task.sourceBlob = undefined; task.state = 'ready'
    task.message = wasImageEdit ? '图生图完成，正在保存到原项目' : '生成完成，正在保存到原项目'
    await persist(task)
    await applyAiTask(task.id)
    toast(`「${task.projectName}」AI 图片生成完成，可在 AI 任务中查看`, 'success')
  } catch (reason) {
    task.state = abort.signal.aborted ? 'paused' : 'error'
    task.message = reason instanceof Error ? reason.message : String(reason)
    await persist(task).catch(() => reflect(task))
    if (!abort.signal.aborted) toast(task.message, 'error')
  } finally { if (controllers.get(activeKey) === abort) controllers.delete(activeKey) }
}
export async function generateAiNode(id: string, prompt: string, sourceBlob?: Blob): Promise<void> {
  const project = useProjectStore.getState()
  const keyId = aiJobKey(project.projectId, id)
  if (controllers.has(keyId) || !prompt.trim() || !project.projectId || project.busy) return
  const node = useCanvasStore.getState().nodes.find((n) => n.id === id)
  if (!node?.data.ai || isNodeLockedByOther(id)) return
  const abort = new AbortController()
  controllers.set(keyId, abort)
  try {
    const state = useAiStore.getState()
    const config = generationSettings(node.data.ai, state.settings)
    const negativePrompt = node.data.ai.draftNegativePrompt ?? config.negativePrompt ?? ''
    // 图生图模式：接管原生图操作，把节点当前图片作为原图执行编辑
    const editMode = !sourceBlob && node.data.ai.genMode === 'edit'
    if (!editMode && config.provider === 'comfy' && negativePrompt.trim() && !config.negativeBinding) throw new Error('请先在 AI 生图设置中绑定反向提示词输入')
    const isSplitImageEdit = config.provider === 'compatible' && !!sourceBlob
    let provider = config.provider
    let endpointModel = config.model
    let apiStyle = node.data.ai.apiStyle
    let serviceUrl: string
    if (editMode) {
      const editBase = state.settings.splitCloudUrl || state.settings.cloudUrl
      if (!editBase.trim()) throw new Error('请先在 AI 生图设置中配置图生图服务地址')
      serviceUrl = baseUrl(editBase)
      endpointModel = (state.settings.splitModel || state.settings.model || '').trim()
      if (!endpointModel) throw new Error('请填写图生图模型名称')
      apiStyle = state.settings.splitProvider === 'dashscope' ? 'dashscope' : 'openai'
      provider = 'compatible'
      if (!node.data.assetId) throw new Error('图生图需要节点已有图片')
      const asset = await db.assets.get(node.data.assetId)
      if (!asset?.blob) throw new Error('原图不可用，请刷新后重试')
      sourceBlob = asset.blob
    } else {
      serviceUrl = baseUrl(config.provider === 'comfy' ? config.comfyUrl : config.cloudUrl)
    }
    const currentUrl = editMode ? (state.settings.splitCloudUrl || state.settings.cloudUrl)
      : config.provider === 'comfy' ? state.settings.comfyUrl
      : isSplitImageEdit ? (state.settings.splitCloudUrl || state.settings.cloudUrl)
      : state.settings.cloudUrl
    // A credential configured for one service must not be sent to another imported endpoint.
    if (serviceUrl !== baseUrl(currentUrl)) throw new Error('原图服务地址与当前设置不同，请先在 AI 生图设置中切换到原服务')
    if (isSplitImageEdit && !(config.model || '').trim()) throw new Error('请填写图生图模型名称')
    const workflow = !editMode && config.provider === 'comfy'
      ? node.data.ai.imageBinding && !config.binding
        ? config.negativeBinding ? prepareWorkflow(parseWorkflow(config.workflow), JSON.parse(config.negativeBinding), negativePrompt, config.randomSeed) : parseWorkflow(config.workflow)
        : prepareWorkflow(parseWorkflow(config.workflow || '{}'), JSON.parse(config.binding || '{}'), prompt.trim(), config.randomSeed,
        config.negativeBinding ? { binding: JSON.parse(config.negativeBinding), prompt: negativePrompt } : undefined) : null
    const key = provider === 'comfy' ? state.comfyKey : state.cloudKey
    const task: AiTask = { id: genUuid(), projectId: project.projectId, projectName: project.projectName,
      nodeId: id, owner: aiOwner(), serviceUrl, needsKey: !!key, sourceBlob, createdAt: Date.now(), updatedAt: Date.now(), state: 'running',
      message: editMode ? '正在提交图生图…' : '正在提交生成…', info: { prompt: prompt.trim(), provider, model: endpointModel,
        size: config.size, workflow: workflow ? JSON.stringify(workflow) : '', binding: config.binding,
        negativePrompt, negativeBinding: config.negativeBinding,
        imageBinding: node.data.ai.imageBinding,
        splitCount: node.data.ai.splitCount,
        apiStyle,
        genMode: editMode ? 'edit' : node.data.ai.genMode,
        randomSeed: config.randomSeed, serviceUrl } }
    await launch(task, abort, key)
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason)
    useAiStore.getState().setJob(keyId, { running: false, message: '', error })
    toast(error, 'error')
  } finally { if (controllers.get(keyId) === abort) controllers.delete(keyId) }
}
export async function resumeAiTask(id: string): Promise<void> {
  const task = await db.aiTasks.get(id)
  if (!task || task.owner !== aiOwner() || controllers.has(jobKey(task))) return
  if (task.state === 'ready') { await applyAiTask(id); return }
  if (task.grid && task.sourceBlob && task.state !== 'done') {
    const abort = new AbortController(); controllers.set(jobKey(task), abort)
    task.state = 'running'; task.message = '正在恢复网格裁切'
    await launch(task, abort, '')
    return
  }
  if (!task.promptId || task.info.provider !== 'comfy' || task.state === 'done') return
  const state = useAiStore.getState()
  if (task.serviceUrl !== baseUrl(state.settings.comfyUrl)) { toast('请先切换到此任务的 ComfyUI 服务地址', 'error'); return }
  if (task.needsKey && !state.comfyKey) { toast('请先在 AI 生图设置中重新填写此服务的 API Key', 'error'); return }
  const abort = new AbortController()
  controllers.set(jobKey(task), abort)
  task.state = 'running'; task.message = '正在恢复原任务，不会重复提交'
  await launch(task, abort, state.comfyKey, true)
}
export async function generateGridNode(id: string, sourceBlob: Blob, grid: NonNullable<AiTask['grid']>) {
  const project = useProjectStore.getState()
  if (!project.projectId || project.busy || controllers.has(aiJobKey(project.projectId, id))) return
  const abort = new AbortController()
  controllers.set(aiJobKey(project.projectId, id), abort)
  await launch({ id: genUuid(), projectId: project.projectId, projectName: project.projectName, nodeId: id,
    owner: aiOwner(), createdAt: Date.now(), updatedAt: Date.now(), state: 'running', message: '正在本地裁切…',
    info: { prompt: `网格裁切 ${grid.rows} × ${grid.columns}`, provider: 'grid', model: '', size: '', workflow: '', binding: '' },
    serviceUrl: '', needsKey: false, sourceBlob, grid }, abort, '')
}
let recovery: Promise<void> | undefined
export function recoverAiTasks(): Promise<void> {
  if (recovery) return recovery
  recovery = (async () => {
    const tasks = await db.aiTasks.where('owner').equals(aiOwner()).toArray()
    for (const task of tasks) {
      if (controllers.has(jobKey(task))) continue
      if (task.state === 'running') {
        task.state = 'paused'
        task.message = task.grid || task.promptId ? '上次运行已中断，可恢复原任务' : '未记录服务端任务编号，请先检查服务端结果后再手动生成'
        await persist(task)
        if (task.promptId && !task.needsKey && task.serviceUrl === useAiStore.getState().settings.comfyUrl.replace(/\/$/, '')) {
          void resumeAiTask(task.id).catch(() => {})
        }
      } else reflect(task)
      if (task.state === 'ready') await applyAiTask(task.id)
    }
  })().finally(() => { recovery = undefined })
  return recovery
}
