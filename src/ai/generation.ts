import { generateComfy, generateCompatible, parseWorkflow, prepareWorkflow } from './client'
import { useAiStore } from './store'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { toast } from '../store/uiStore'
import { createNodeForAsset, putAsset } from '../io/fileLoader'
import { isNodeLockedByOther } from '../sync/lanClient'
import type { SuqNodeData } from '../types'

const controllers = new Map<string, AbortController>()
export function stopAiGeneration(id: string) {
  controllers.get(id)?.abort(new Error('已停止等待，服务端任务可能仍在运行。'))
}

// Generation belongs to the node, not its editor: hiding the editor never cancels it.
export async function generateAiNode(id: string, prompt: string): Promise<void> {
  if (controllers.has(id) || !prompt.trim()) return
  const node = useCanvasStore.getState().nodes.find((n) => n.id === id)
  if (!node?.data.ai || isNodeLockedByOther(id)) return
  const projectId = useProjectStore.getState().projectId
  const { settings, comfyKey, cloudKey, setJob } = useAiStore.getState()
  const abort = new AbortController()
  controllers.set(id, abort)
  const currentNode = () => projectId === useProjectStore.getState().projectId
    ? useCanvasStore.getState().nodes.find((n) => n.id === id) : undefined
  const progress = (message: string) => setJob(id, { running: true, message })
  progress('正在提交生成…')
  let info: NonNullable<SuqNodeData['ai']> = { prompt: prompt.trim(), provider: settings.provider,
    model: settings.model, size: settings.size, workflow: settings.workflow, binding: settings.binding,
    randomSeed: settings.randomSeed }
  try {
    const workflow = settings.provider === 'comfy'
      ? prepareWorkflow(parseWorkflow(settings.workflow || '{}'), JSON.parse(settings.binding || '{}'), info.prompt, settings.randomSeed) : null
    info = { ...info, workflow: workflow ? JSON.stringify(workflow) : '' }
    // Keep the provenance of an existing image intact while its replacement is pending.
    if (!node.data.assetId) useCanvasStore.getState().updateNodeData(id, { ai: { ...info, status: 'generating' } })
    const blobs = workflow
      ? await generateComfy({ url: settings.comfyUrl, key: comfyKey }, workflow, JSON.parse(settings.binding), info.prompt, abort.signal, progress, true)
      : await generateCompatible({ url: settings.cloudUrl, key: cloudKey, model: settings.model }, info.prompt, settings.size)
    abort.signal.throwIfAborted()
    for (const blob of blobs) { const bitmap = await createImageBitmap(blob); bitmap.close() }
    if (!currentNode()) throw new Error('画布已切换或 AI 图片已删除，生成结果未写入画布。')
    const assets = []
    for (const [index, blob] of blobs.entries()) {
      abort.signal.throwIfAborted()
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
      assets.push(await putAsset(new File([blob], `AI-${Date.now()}-${index + 1}.${extension}`, { type: blob.type || 'image/png' })))
    }
    abort.signal.throwIfAborted()
    const current = currentNode()
    if (!current) throw new Error('画布已切换或 AI 图片已删除，生成结果未写入画布。')
    const finished = { ...info, status: 'done' as const, generatedAt: Date.now() }
    useCanvasStore.getState().updateNodeData(id, { ...createNodeForAsset(assets[0], current.position).data, ai: finished })
    if (assets.length > 1) useCanvasStore.getState().addNodes(assets.slice(1).map((asset, index) => {
      const extra = createNodeForAsset(asset, { x: current.position.x + (index + 1) * 360, y: current.position.y })
      return { ...extra, parentId: current.parentId, data: { ...extra.data, ai: finished } }
    }))
    setJob(id, { running: false, message: `已生成 ${assets.length} 张图片` })
    toast('AI 图片生成完成', 'success')
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason)
    if (currentNode() && !node.data.assetId) useCanvasStore.getState().updateNodeData(id, { ai: { ...info, status: 'error', error } })
    setJob(id, { running: false, message: '', error })
    toast(error, 'error')
  } finally { controllers.delete(id) }
}
