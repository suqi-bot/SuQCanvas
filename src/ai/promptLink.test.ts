import { describe, expect, it, beforeEach } from 'vitest'
import type { Connection } from '@xyflow/react'
import type { SuqEdge, SuqNode } from '../types'
import { DEFAULT_EDGE_STYLE } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import {
  applyPromptConnection,
  findAiTargetsForPrompt,
  findLinkedPromptNode,
  isAiPromptEditingLocked,
  readPromptContent,
  updatePromptNodeContent,
} from './promptLink'

function connection(source: string, target: string): Connection {
  return { source, target, sourceHandle: null, targetHandle: null }
}

function promptNode(id: string, text = '一只猫', negativePrompt = '模糊'): SuqNode {
  return {
    id,
    type: 'prompt',
    position: { x: 0, y: 0 },
    data: { kind: 'prompt', label: '提示词', text, negativePrompt },
  }
}

function aiNode(id: string, draftPrompt = '', draftNegativePrompt = ''): SuqNode {
  return {
    id,
    type: 'image',
    position: { x: 200, y: 0 },
    data: {
      kind: 'image',
      label: 'AI 图片',
      ai: {
        prompt: '',
        draftPrompt,
        draftNegativePrompt,
        provider: '',
        model: '',
        size: '',
        workflow: '',
        binding: '',
        status: 'draft',
      },
    },
  }
}

function edge(source: string, target: string): SuqEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'styled',
    data: { style: { ...DEFAULT_EDGE_STYLE } },
  }
}

beforeEach(() => {
  useCanvasStore.getState().reset()
  useCanvasStore.getState().clearHistory()
})

describe('提示词节点与 AI 图片连线', () => {
  it('连线后自动把正向与反向提示词填入 AI 图片', () => {
    useCanvasStore.getState().addNodes([promptNode('p1'), aiNode('a1')])
    useCanvasStore.getState().onConnect(connection('p1', 'a1'))
    applyPromptConnection(connection('p1', 'a1'))

    const ai = useCanvasStore.getState().nodes.find((n) => n.id === 'a1')!
    expect(ai.data.ai?.draftPrompt).toBe('一只猫')
    expect(ai.data.ai?.draftNegativePrompt).toBe('模糊')
    expect(isAiPromptEditingLocked('a1', useCanvasStore.getState().nodes, useCanvasStore.getState().edges)).toBe(true)
  })

  it('反向连线同样视为已连接并锁定编辑', () => {
    useCanvasStore.getState().addNodes([promptNode('p1'), aiNode('a1')])
    useCanvasStore.getState().onConnect(connection('a1', 'p1'))
    applyPromptConnection(connection('a1', 'p1'))

    const nodes = useCanvasStore.getState().nodes
    const edges = useCanvasStore.getState().edges
    expect(findLinkedPromptNode('a1', nodes, edges)?.id).toBe('p1')
    expect(isAiPromptEditingLocked('a1', nodes, edges)).toBe(true)
    expect(nodes.find((n) => n.id === 'a1')?.data.ai?.draftPrompt).toBe('一只猫')
  })

  it('修改提示词节点会同步到已连接的 AI 图片', () => {
    useCanvasStore.getState().addNodes([promptNode('p1', '旧词', '旧反向'), aiNode('a1', 'x', 'y')])
    useCanvasStore.getState().addEdge(edge('p1', 'a1'))

    updatePromptNodeContent('p1', { prompt: '新词', negativePrompt: '新反向' })

    const nodes = useCanvasStore.getState().nodes
    expect(readPromptContent(nodes.find((n) => n.id === 'p1')!)).toEqual({
      prompt: '新词',
      negativePrompt: '新反向',
    })
    expect(nodes.find((n) => n.id === 'a1')?.data.ai?.draftPrompt).toBe('新词')
    expect(nodes.find((n) => n.id === 'a1')?.data.ai?.draftNegativePrompt).toBe('新反向')
  })

  it('生成方式写入提示词节点并同步到已连接的 AI 图片', () => {
    useCanvasStore.getState().addNodes([promptNode('p1'), aiNode('a1')])
    useCanvasStore.getState().addEdge(edge('p1', 'a1'))

    updatePromptNodeContent('p1', { genMode: 'edit' })

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'p1')?.data.genMode).toBe('edit')
    expect(readPromptContent(nodes.find((n) => n.id === 'p1')!)).toMatchObject({ genMode: 'edit' })
    expect(nodes.find((n) => n.id === 'a1')?.data.ai?.genMode).toBe('edit')
  })

  it('连线时把生成方式一并填入 AI 图片', () => {
    const prompt = promptNode('p1')
    prompt.data.genMode = 'edit'
    useCanvasStore.getState().addNodes([prompt, aiNode('a1')])
    useCanvasStore.getState().onConnect(connection('p1', 'a1'))
    applyPromptConnection(connection('p1', 'a1'))

    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'a1')?.data.ai?.genMode).toBe('edit')
  })

  it('删除连线后不再锁定 AI 提示词编辑', () => {
    useCanvasStore.getState().addNodes([promptNode('p1'), aiNode('a1')])
    useCanvasStore.getState().addEdge(edge('p1', 'a1'))
    expect(
      isAiPromptEditingLocked('a1', useCanvasStore.getState().nodes, useCanvasStore.getState().edges),
    ).toBe(true)

    useCanvasStore.getState().onEdgesChange([{ id: 'e-p1-a1', type: 'remove' }])
    expect(
      isAiPromptEditingLocked('a1', useCanvasStore.getState().nodes, useCanvasStore.getState().edges),
    ).toBe(false)
  })

  it('普通文本连线不会锁定 AI 提示词', () => {
    const text: SuqNode = {
      id: 't1',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { kind: 'text', label: '文本', text: '普通文本' },
    }
    useCanvasStore.getState().addNodes([text, aiNode('a1')])
    useCanvasStore.getState().onConnect(connection('t1', 'a1'))
    applyPromptConnection(connection('t1', 'a1'))

    const nodes = useCanvasStore.getState().nodes
    const edges = useCanvasStore.getState().edges
    expect(isAiPromptEditingLocked('a1', nodes, edges)).toBe(false)
    expect(findAiTargetsForPrompt('t1', nodes, edges)).toHaveLength(0)
    expect(nodes.find((n) => n.id === 'a1')?.data.ai?.draftPrompt).toBe('')
  })
})
