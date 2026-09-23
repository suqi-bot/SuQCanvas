import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'
import { useCanvasStore } from './canvasStore'
import { usePlayerStore } from './playerStore'

vi.mock('../media/blobRegistry', () => ({ getAssetUrl: async (id: string) => `blob:${id}` }))

afterEach(() => {
  usePlayerStore.getState().stop()
  useCanvasStore.getState().reset()
})

test('MP3 连线切到下一节点后仍可回到上一节点', async () => {
  const nodes: SuqNode[] = ['A', 'B', 'C'].map((assetId) => ({
    id: assetId.toLowerCase(), type: 'audio', position: { x: 0, y: 0 },
    data: { kind: 'audio', assetId, label: assetId },
  }))
  const edges: SuqEdge[] = [
    { id: 'ab', source: 'a', target: 'b', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } },
    { id: 'bc', source: 'b', target: 'c', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } },
  ]
  useCanvasStore.setState({ nodes, edges })
  usePlayerStore.getState().setMode('flow')
  usePlayerStore.getState().play({ assetId: 'A', nodeId: 'a' })
  await vi.waitFor(() => expect(usePlayerStore.getState().track?.assetId).toBe('A'))

  usePlayerStore.getState().next()
  await vi.waitFor(() => expect(usePlayerStore.getState().track?.assetId).toBe('B'))
  usePlayerStore.getState().prev()
  await vi.waitFor(() => expect(usePlayerStore.getState().track?.assetId).toBe('A'))
})
