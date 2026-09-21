import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SuqNode } from '../types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), putAsset: vi.fn(), toast: vi.fn(), project: { projectId: 'project-a' },
}))
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), generateCompatible: mocks.generate }))
vi.mock('../store/projectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
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
import { generateAiNode, stopAiGeneration } from './generation'

function node(id: string): SuqNode {
  return { id, type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image',
    ai: { prompt: '', provider: '', model: '', size: '', workflow: '', binding: '', status: 'draft' } } }
}
function deferred() {
  let resolve!: (value: Blob[]) => void
  const promise = new Promise<Blob[]>((done) => { resolve = done })
  return { promise, resolve: () => resolve([new Blob(['image'], { type: 'image/png' })]) }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.project.projectId = 'project-a'
  useCanvasStore.setState({ nodes: [node('one'), node('two')] })
  useAiStore.setState({ jobs: {}, settingsOpen: true })
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
  expect(mocks.generate).toHaveBeenCalledTimes(2)
  useAiStore.getState().setSettingsOpen(false)
  useAiStore.getState().setSettings({ model: 'changed-model' })
  expect(useAiStore.getState().jobs.one.running).toBe(true)
  second.resolve(); await b
  expect(useAiStore.getState().jobs.one.running).toBe(true)
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
  expect(useAiStore.getState().jobs.one).toMatchObject({ running: false, error: '服务不可用' })
})

it('does not resurrect a deleted node or import its images', async () => {
  const pending = deferred()
  mocks.generate.mockReturnValueOnce(pending.promise)
  const task = generateAiNode('one', '删除测试')
  useCanvasStore.setState({ nodes: [] })
  pending.resolve(); await task
  expect(mocks.putAsset).not.toHaveBeenCalled()
  expect(useCanvasStore.getState().nodes).toEqual([])
})

it('does not write a pending result into another project', async () => {
  const pending = deferred()
  mocks.generate.mockReturnValueOnce(pending.promise)
  const task = generateAiNode('one', '切换项目测试')
  mocks.project.projectId = 'project-b'
  pending.resolve(); await task
  expect(mocks.putAsset).not.toHaveBeenCalled()
  expect(useAiStore.getState().jobs.one.error).toContain('画布已切换')
})

it('stopping one job leaves other jobs running', async () => {
  const first = deferred(), second = deferred()
  mocks.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a = generateAiNode('one', '取消')
  const b = generateAiNode('two', '继续')
  stopAiGeneration('one')
  first.resolve(); await a
  expect(useAiStore.getState().jobs.one.error).toContain('已停止等待')
  expect(useAiStore.getState().jobs.two.running).toBe(true)
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
