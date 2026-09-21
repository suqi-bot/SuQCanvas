import 'fake-indexeddb/auto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SuqNode } from '../types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), putAsset: vi.fn(), toast: vi.fn(), resume: vi.fn(), project: { projectId: 'project-a', projectName: '项目 A', initialized: true, loaded: true, busy: false, saveStatus: 'saved', saveNow: vi.fn() },
}))
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), generateCompatible: mocks.generate, waitForComfy: mocks.resume }))
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
  const saved = JSON.parse(setItem.mock.calls[0][1])
  expect(saved.model).toBe('test-model')
  expect(saved).not.toHaveProperty('cloudKey')
  expect(saved).not.toHaveProperty('jobs')
  expect(setItem.mock.calls[0][1]).not.toContain('test-secret')
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
  await generateAiNode('one', '拆图', new Blob(['original'], { type: 'image/png' }))
  const submitted = JSON.parse(fetch.mock.calls[1][1].body).prompt
  expect(submitted.load.inputs.image).toBe('split/uploaded.png')
  expect(submitted.negative.inputs.text).toBe('水印')
  expect(useCanvasStore.getState().nodes.find((n) => n.id === 'source')?.data.assetId).toBe('original-asset')
  const saved = (await db.aiTasks.toArray())[0]
  expect(saved.state).toBe('done')
  expect(saved.sourceBlob).toBeUndefined()
  expect(saved.info.negativePrompt).toBe('水印')
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
