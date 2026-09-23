import 'fake-indexeddb/auto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SuqNode } from '../types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), edit: vi.fn(), editDashscope: vi.fn(), putAsset: vi.fn(), toast: vi.fn(), resume: vi.fn(), project: { projectId: 'project-a', projectName: '项目 A', initialized: true, loaded: true, busy: false, saveStatus: 'saved', saveNow: vi.fn() },
}))
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), generateCompatible: mocks.generate, editCompatibleImage: mocks.edit, editDashscopeImage: mocks.editDashscope, waitForComfy: mocks.resume }))
vi.mock('../store/projectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('../store/authStore', () => ({ useAuthStore: { getState: () => ({ user: null }) } }))
vi.mock('../store/uiStore', () => ({ toast: mocks.toast }))
vi.mock('../sync/lanClient', () => ({ isNodeLockedByOther: () => false }))
vi.mock('../io/fileLoader', () => ({
  putAsset: mocks.putAsset,
  createNodeForAsset: (asset: { id: string }, position: { x: number; y: number }) => ({
    id: `node-${asset.id}`, position, type: 'image', data: { kind: 'image', assetId: asset.id },
  }),
}))

import { useAiStore, saveAiSettings } from './store'
import { useCanvasStore } from '../store/canvasStore'
import { applyAiTask, generateAiNode, generationSettings, recoverAiTasks, resumeAiTask, stopAiGeneration } from './generation'
import { db } from '../db/db'
import type { AiTask } from './taskTypes'

function node(id: string): SuqNode {
  return { id, type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image',
    ai: { prompt: '', provider: '', model: '', size: '', workflow: '', binding: '', status: 'draft' } } }
}
function deferred() {
  let resolve!: (value: Blob[]) => void
  const promise = new Promise<Blob[]>((done) => { resolve = done })
  return { promise, resolve: () => resolve([new Blob(['image'], { type: 'image/png' })]) }
}
beforeEach(async () => {
  await db.aiTasks.clear()
  await db.projects.clear()
  vi.clearAllMocks()
  mocks.project.projectId = 'project-a'
  useCanvasStore.setState({ nodes: [node('one'), node('two')] })
  useAiStore.setState({ jobs: {}, tasks: [], settingsOpen: true })
  mocks.project.busy = false
  mocks.project.saveStatus = 'saved'
  mocks.project.saveNow.mockImplementation(async () => {
    const nodes = useCanvasStore.getState().nodes
    await db.projects.put({ id: mocks.project.projectId, name: '项目 A', createdAt: 1, updatedAt: Date.now(), graph: { nodes, edges: [] }, viewport: { x: 0, y: 0, zoom: 1 } })
  })
  await mocks.project.saveNow()
  useAiStore.getState().setSettings({ provider: 'compatible', cloudUrl: 'http://example.test', model: 'test-model', size: '1024x1024' })
  mocks.putAsset.mockImplementation(async () => ({ id: `asset-${mocks.putAsset.mock.calls.length}` }))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close() {} })))
})
afterEach(() => vi.unstubAllGlobals())

it('continues independent jobs after closing settings and preserves the submitted settings', async () => {
  const first = deferred(), second = deferred()
  mocks.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a = generateAiNode('one', '第一张')
  const b = generateAiNode('two', '第二张')
  await generateAiNode('one', '重复发送')
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
  useAiStore.getState().setSettingsOpen(false)
  useAiStore.getState().setSettings({ model: 'changed-model' })
  expect(useAiStore.getState().jobs['project-a:one'].running).toBe(true)
  second.resolve(); await b
  expect(useAiStore.getState().jobs['project-a:one'].running).toBe(true)
  first.resolve(); await a
  expect(useCanvasStore.getState().nodes[0].data.ai).toMatchObject({ prompt: '第一张', model: 'test-model', status: 'done' })
  expect(useCanvasStore.getState().nodes[1].data.ai).toMatchObject({ prompt: '第二张', status: 'done' })
  expect(useAiStore.getState().settingsOpen).toBe(false)
})

it('keeps the original image and metadata when a replacement fails', async () => {
  const original = node('one')
  original.data.assetId = 'original'
  original.data.ai = { ...original.data.ai!, prompt: '原始提示词', status: 'done', generatedAt: 123 }
  useCanvasStore.setState({ nodes: [original] })
  mocks.generate.mockRejectedValueOnce(new Error('服务不可用'))
  await generateAiNode('one', '新需求')
  expect(useCanvasStore.getState().nodes[0].data).toEqual(original.data)
  expect(useAiStore.getState().jobs['project-a:one']).toMatchObject({ running: false, error: '服务不可用' })
})

it('does not resurrect a deleted node and preserves its result in the task list', async () => {
  const pending = deferred()
  mocks.generate.mockReturnValueOnce(pending.promise)
  const task = generateAiNode('one', '删除测试')
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce())
  useCanvasStore.setState({ nodes: [] })
  pending.resolve(); await task
  expect((await db.aiTasks.toArray())[0]).toMatchObject({ state: 'ready' })
  expect((await db.aiTasks.toArray())[0].blobs).toHaveLength(1)
  expect(useCanvasStore.getState().nodes).toEqual([])
})

it('writes a completed result back to the original project without touching the active project', async () => {
  const pending = deferred()
  mocks.generate.mockReturnValueOnce(pending.promise)
  const task = generateAiNode('one', '切换项目测试')
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce())
  mocks.project.projectId = 'project-b'
  useCanvasStore.setState({ nodes: [node('other')] })
  pending.resolve(); await task
  expect((await db.projects.get('project-a'))!.graph.nodes[0].data.ai?.prompt).toBe('切换项目测试')
  expect(useCanvasStore.getState().nodes[0].id).toBe('other')
  expect((await db.aiTasks.toArray())[0].state).toBe('done')
})

it('stopping one job leaves other jobs running', async () => {
  const first = deferred(), second = deferred()
  mocks.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a = generateAiNode('one', '取消')
  const b = generateAiNode('two', '继续')
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
  stopAiGeneration('one')
  await a
  first.resolve()
  expect(useAiStore.getState().jobs['project-a:one'].message).toContain('已停止等待')
  expect(useAiStore.getState().jobs['project-a:two'].running).toBe(true)
  second.resolve(); await b
  expect(useCanvasStore.getState().nodes[1].data.assetId).toBeDefined()
})

it('persists settings without credentials or active job state', () => {
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', { setItem })
  useAiStore.getState().setCredentials({ comfyKey: 'test-secret', cloudKey: 'test-secret', llmKey: 'test-secret' })
  saveAiSettings()
  const settingsCall = setItem.mock.calls.find(([key]) => key === 'suqcanvas-ai-settings-v1')
  expect(settingsCall).toBeDefined()
  const saved = JSON.parse(settingsCall![1] as string)
  expect(saved.model).toBe('test-model')
  expect(saved).not.toHaveProperty('cloudKey')
  expect(saved).not.toHaveProperty('jobs')
  expect(settingsCall![1] as string).not.toContain('test-secret')
  const credentialsCall = setItem.mock.calls.find(([key]) => key === 'suqcanvas-ai-credentials-v1')
  expect(credentialsCall?.[1]).toContain('test-secret')
})

function task(overrides: Partial<AiTask> = {}): AiTask {
  return { id: 'recover-task', projectId: 'project-a', projectName: '项目 A', nodeId: 'one', owner: 'local',
    serviceUrl: 'http://example.test', needsKey: false, createdAt: 1, updatedAt: 1,
    state: 'running', message: '处理中', info: { prompt: '恢复测试', provider: 'comfy', model: '', size: '', workflow: '', binding: '' }, ...overrides }
}

it('recovers an interrupted ComfyUI task by polling its original ID without submitting again', async () => {
  useAiStore.getState().setSettings({ comfyUrl: 'http://example.test' })
  await db.aiTasks.put(task({ promptId: 'server-job-id' }))
  mocks.resume.mockResolvedValueOnce([new Blob(['image'], { type: 'image/png' })])
  await recoverAiTasks()
  await vi.waitFor(async () => expect((await db.aiTasks.get('recover-task'))?.state).toBe('done'))
  expect(mocks.resume.mock.calls[0][1]).toBe('server-job-id')
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('does not resubmit interrupted requests without a server task ID', async () => {
  await db.aiTasks.put(task({ info: { ...task().info, provider: 'compatible' } }))
  await recoverAiTasks()
  expect((await db.aiTasks.get('recover-task'))?.state).toBe('paused')
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.resume).not.toHaveBeenCalled()
})

it('never sends a configured key to a task belonging to a different endpoint', async () => {
  await db.aiTasks.put(task({ promptId: 'id', needsKey: true, state: 'paused', serviceUrl: 'https://different.example' }))
  await resumeAiTask('recover-task')
  expect(mocks.resume).not.toHaveBeenCalled()
})

it('defers applying during project transitions and applies the saved result only once', async () => {
  await db.aiTasks.put(task({ state: 'ready', blobs: [new Blob(['result'], { type: 'image/png' })] }))
  mocks.project.busy = true
  await applyAiTask('recover-task')
  expect(useCanvasStore.getState().nodes[0].data.assetId).toBeUndefined()
  mocks.project.busy = false
  await applyAiTask('recover-task')
  await applyAiTask('recover-task')
  expect(mocks.putAsset).toHaveBeenCalledOnce()
  expect(useCanvasStore.getState().nodes[0].data.ai?.generationId).toBe('recover-task')
  expect((await db.aiTasks.get('recover-task'))?.state).toBe('done')
})

it('retains parameter provenance and uses the original fixed seed only when requested', () => {
  const settings = useAiStore.getState().settings
  const ai = { ...task().info, provider: 'compatible', model: 'original-model', size: '512x512', parameterSource: 'original' as const }
  expect(generationSettings(ai, settings)).toMatchObject({ model: 'original-model', size: '512x512', randomSeed: false })
  expect(generationSettings({ ...ai, parameterSource: 'current' }, settings).model).toBe('test-model')
})

it('keeps a separately saved draft when a generation result is applied', async () => {
  const original = node('one')
  original.data.ai!.draftPrompt = '下一次生成的草稿'
  useCanvasStore.setState({ nodes: [original] })
  await db.aiTasks.put(task({ state: 'ready', blobs: [new Blob(['result'], { type: 'image/png' })] }))
  await applyAiTask('recover-task')
  expect(useCanvasStore.getState().nodes[0].data.ai).toMatchObject({ prompt: '恢复测试', draftPrompt: '下一次生成的草稿' })
})

it('uploads a split source, binds negative text, and retains the original image', async () => {
  const source = node('source')
  source.data.assetId = 'original-asset'
  const target = node('one')
  target.data.ai = { ...target.data.ai!, provider: 'comfy', parameterSource: 'original', serviceUrl: 'http://example.test',
    workflow: JSON.stringify({ load: { class_type: 'LoadImage', inputs: { image: 'old.png' } }, negative: { class_type: 'CLIPTextEncode', inputs: { text: 'old' } } }),
    imageBinding: JSON.stringify({ node: 'load', input: 'image' }), negativeBinding: JSON.stringify({ node: 'negative', input: 'text' }), draftNegativePrompt: '水印' }
  useCanvasStore.setState({ nodes: [source, target] })
  useAiStore.getState().setSettings({ comfyUrl: 'http://example.test' })
  const fetch = vi.fn()
  for (const value of [{ name: 'uploaded.png', subfolder: 'split' }, { prompt_id: 'split-id' },
    { 'split-id': { status: { completed: true }, outputs: { layers: { images: [{ filename: 'layer.png', subfolder: '', type: 'output' }] } } } }, {}]) {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)))
  }
  vi.stubGlobal('fetch', fetch)
  await generateAiNode('one', '图生图', new Blob(['original'], { type: 'image/png' }))
  const submitted = JSON.parse(fetch.mock.calls[1][1].body).prompt
  expect(submitted.load.inputs.image).toBe('split/uploaded.png')
  expect(submitted.negative.inputs.text).toBe('水印')
  expect(useCanvasStore.getState().nodes.find((n) => n.id === 'source')?.data.assetId).toBe('original-asset')
  const saved = (await db.aiTasks.toArray())[0]
  expect(saved.state).toBe('done')
  expect(saved.sourceBlob).toBeUndefined()
  expect(saved.info.negativePrompt).toBe('水印')
})

it('runs OpenAI-compatible image edit for split with source blob', async () => {
  const target = node('one')
  target.data.ai = { ...target.data.ai!, provider: 'compatible', parameterSource: 'original',
    serviceUrl: 'http://example.test/v1', model: 'edit-model', size: '1024x1024',
    splitCount: 2, workflow: '', binding: '', draftNegativePrompt: '水印' }
  useCanvasStore.setState({ nodes: [target] })
  useAiStore.getState().setSettings({ splitProvider: 'compatible', splitCloudUrl: 'http://example.test/v1', splitModel: 'edit-model', cloudUrl: 'http://other.test/v1' })
  mocks.edit.mockResolvedValueOnce([
    new Blob(['layer-a'], { type: 'image/png' }),
    new Blob(['layer-b'], { type: 'image/png' }),
  ])
  await generateAiNode('one', '拆为主体背景', new Blob(['source'], { type: 'image/png' }))
  expect(mocks.edit).toHaveBeenCalledOnce()
  expect(mocks.edit.mock.calls[0][0]).toMatchObject({ url: 'http://example.test/v1', model: 'edit-model' })
  expect(await mocks.edit.mock.calls[0][1].text()).toBe('source')
  expect(mocks.edit.mock.calls[0][2]).toBe('拆为主体背景')
  expect(mocks.edit.mock.calls[0][4]).toMatchObject({ n: 2, negativePrompt: '水印' })
  expect(mocks.generate).not.toHaveBeenCalled()
  const saved = (await db.aiTasks.toArray())[0]
  expect(saved.state).toBe('done')
  expect(saved.info.provider).toBe('compatible')
  // First layer updates the original node; remaining layers are added beside it.
  expect(useCanvasStore.getState().nodes).toHaveLength(2)
})

it('routes apiStyle dashscope split to the multimodal-generation edit API', async () => {
  const target = node('one')
  target.data.ai = { ...target.data.ai!, provider: 'compatible', apiStyle: 'dashscope', parameterSource: 'original',
    serviceUrl: 'https://maas.qianwenaiapi.com/api/v1', model: 'qwen-image-3.0', size: '',
    splitCount: 2, workflow: '', binding: '', draftNegativePrompt: '水印' }
  useCanvasStore.setState({ nodes: [target] })
  useAiStore.getState().setSettings({ splitProvider: 'dashscope', splitCloudUrl: 'https://maas.qianwenaiapi.com/api/v1', splitModel: 'qwen-image-3.0', cloudUrl: 'http://other.test/v1' })
  mocks.editDashscope.mockResolvedValueOnce([new Blob(['layer'], { type: 'image/png' })])
  await generateAiNode('one', '拆为主体背景', new Blob(['source'], { type: 'image/png' }))
  expect(mocks.editDashscope).toHaveBeenCalledOnce()
  expect(mocks.editDashscope.mock.calls[0][0]).toMatchObject({ url: 'https://maas.qianwenaiapi.com/api/v1', model: 'qwen-image-3.0' })
  expect(mocks.edit).not.toHaveBeenCalled()
  expect(mocks.editDashscope.mock.calls[0][4]).toMatchObject({ n: 2, negativePrompt: '水印' })
  const saved = (await db.aiTasks.toArray())[0]
  expect(saved.state).toBe('done')
  expect(saved.info.apiStyle).toBe('dashscope')
})

it('runs in-place img2img and stores the result as a preview without replacing the original', async () => {
  const target = node('one')
  target.data.assetId = 'original-asset'
  target.data.ai = { ...target.data.ai!, genMode: 'edit', status: 'done' }
  useCanvasStore.setState({ nodes: [target] })
  await db.assets.put({ id: 'original-asset', name: 'a.png', mime: 'image/png', size: 4, kind: 'image', blob: new Blob(['orig']) })
  useAiStore.getState().setSettings({ provider: 'compatible', cloudUrl: 'http://example.test/v1', model: 'edit-model', splitCloudUrl: '', splitModel: '', splitProvider: 'compatible' })
  mocks.edit.mockResolvedValueOnce([new Blob(['edited'], { type: 'image/png' })])

  await generateAiNode('one', '改成夜景')

  expect(mocks.edit).toHaveBeenCalledOnce()
  expect(mocks.edit.mock.calls[0][0]).toMatchObject({ url: 'http://example.test/v1', model: 'edit-model' })
  expect(await mocks.edit.mock.calls[0][1].text()).toBe('orig')
  expect(mocks.edit.mock.calls[0][2]).toBe('改成夜景')
  const saved = (await db.aiTasks.toArray())[0]
  expect(saved.state).toBe('done')
  expect(saved.info.genMode).toBe('edit')
  expect(saved.info.provider).toBe('compatible')
  expect(saved.previewAssetId).toBeTruthy()
  const data = useCanvasStore.getState().nodes[0].data
  expect(data.assetId).toBe('original-asset')
  expect(data.ai?.editPreviewAssetId).toBe(saved.previewAssetId)
  expect(data.ai?.generationId).toBe(saved.id)
  expect(useCanvasStore.getState().nodes).toHaveLength(1)
})

it('requires an image and an img2img endpoint for in-place editing', async () => {
  const target = node('one')
  target.data.ai = { ...target.data.ai!, genMode: 'edit' }
  useCanvasStore.setState({ nodes: [target] })
  await generateAiNode('one', '改一下')
  expect(mocks.toast).toHaveBeenCalledWith('图生图需要节点已有图片', 'error')
  expect(mocks.edit).not.toHaveBeenCalled()

  target.data.assetId = 'original-asset'
  useCanvasStore.setState({ nodes: [{ ...target }] })
  await db.assets.put({ id: 'original-asset', name: 'a.png', mime: 'image/png', size: 4, kind: 'image', blob: new Blob(['orig']) })
  useAiStore.getState().setSettings({ cloudUrl: '', splitCloudUrl: '' })
  await generateAiNode('one', '改一下')
  expect(mocks.toast).toHaveBeenCalledWith('请先在 AI 生图设置中配置图生图服务地址', 'error')
  expect(mocks.edit).not.toHaveBeenCalled()
})

it('places grid outputs in rows without AI metadata and applies them idempotently', async () => {
  await db.aiTasks.put(task({ state: 'ready', grid: { rows: 2, columns: 2, gap: 0, margin: 0 }, blobs: Array.from({ length: 4 }, () => new Blob(['cell'], { type: 'image/png' })) }))
  await applyAiTask('recover-task')
  const result = useCanvasStore.getState().nodes
  expect(result.find((n) => n.id === 'one')?.data.ai).toBeUndefined()
  expect(result.find((n) => n.id === 'ai-recover-task-2')?.position).toEqual({ x: 0, y: 400 })
  await db.aiTasks.update('recover-task', { state: 'ready' })
  await applyAiTask('recover-task')
  expect(useCanvasStore.getState().nodes).toHaveLength(result.length)
  expect(mocks.putAsset).toHaveBeenCalledTimes(4)
})
