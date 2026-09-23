import type { Connection } from '@xyflow/react'
import type { SuqEdge, SuqNode } from '../types'
import { useCanvasStore } from '../store/canvasStore'

export interface PromptContent {
  prompt: string
  negativePrompt: string
  genMode?: 'text' | 'edit'
}

export function isPromptNode(node?: SuqNode | null): boolean {
  return node?.data.kind === 'prompt'
}

export function isAiImageNode(node?: SuqNode | null): boolean {
  return !!node?.data.ai
}

export function readPromptContent(node: SuqNode): PromptContent {
  return {
    prompt: node.data.text ?? '',
    negativePrompt: node.data.negativePrompt ?? '',
    genMode: node.data.genMode,
  }
}

function nodeById(nodes: SuqNode[], id: string): SuqNode | undefined {
  return nodes.find((node) => node.id === id)
}

/** 与 AI 图片相连的提示词节点（任一方向连线都算） */
export function findLinkedPromptNode(
  aiNodeId: string,
  nodes: SuqNode[],
  edges: SuqEdge[],
): SuqNode | null {
  for (const edge of edges) {
    if (edge.target === aiNodeId) {
      const source = nodeById(nodes, edge.source)
      if (isPromptNode(source)) return source ?? null
    }
    if (edge.source === aiNodeId) {
      const target = nodeById(nodes, edge.target)
      if (isPromptNode(target)) return target ?? null
    }
  }
  return null
}

export function isAiPromptEditingLocked(
  aiNodeId: string,
  nodes: SuqNode[],
  edges: SuqEdge[],
): boolean {
  return findLinkedPromptNode(aiNodeId, nodes, edges) !== null
}

/** 与提示词节点相连的全部 AI 图片节点 */
export function findAiTargetsForPrompt(
  promptNodeId: string,
  nodes: SuqNode[],
  edges: SuqEdge[],
): SuqNode[] {
  if (!isPromptNode(nodeById(nodes, promptNodeId))) return []
  const targetIds = new Set<string>()
  for (const edge of edges) {
    if (edge.source === promptNodeId) targetIds.add(edge.target)
    if (edge.target === promptNodeId) targetIds.add(edge.source)
  }
  return nodes.filter((node) => targetIds.has(node.id) && isAiImageNode(node))
}

function writeAiDraft(node: SuqNode, content: PromptContent): SuqNode {
  if (!node.data.ai) return node
  const ai = node.data.ai
  const modeSynced = content.genMode === undefined || ai.genMode === content.genMode
  if ((ai.draftPrompt ?? '') === content.prompt && (ai.draftNegativePrompt ?? '') === content.negativePrompt && modeSynced) {
    return node
  }
  return {
    ...node,
    data: {
      ...node.data,
      ai: {
        ...ai,
        draftPrompt: content.prompt,
        draftNegativePrompt: content.negativePrompt,
        ...(content.genMode !== undefined ? { genMode: content.genMode } : {}),
      },
    },
  }
}

/** 把提示词节点内容写入已连接的 AI 图片草稿 */
export function fillAiFromPrompt(aiNodeId: string, content: PromptContent): void {
  const store = useCanvasStore.getState()
  const node = nodeById(store.nodes, aiNodeId)
  if (!node?.data.ai) return
  const next = writeAiDraft(node, content)
  if (next === node) return
  store.updateNodeData(aiNodeId, next.data as Partial<SuqNode['data']>)
}

/** 更新提示词节点，并同步到所有已连接的 AI 图片 */
export function updatePromptNodeContent(
  promptNodeId: string,
  patch: Pick<Partial<PromptContent>, 'prompt' | 'negativePrompt' | 'genMode'>,
): void {
  const store = useCanvasStore.getState()
  const promptNode = nodeById(store.nodes, promptNodeId)
  if (!isPromptNode(promptNode)) return

  const current = readPromptContent(promptNode!)
  const content: PromptContent = {
    prompt: patch.prompt !== undefined ? patch.prompt : current.prompt,
    negativePrompt: patch.negativePrompt !== undefined ? patch.negativePrompt : current.negativePrompt,
    genMode: patch.genMode !== undefined ? patch.genMode : current.genMode,
  }

  store.updateNodeData(promptNodeId, {
    ...(patch.prompt !== undefined ? { text: content.prompt } : {}),
    ...(patch.negativePrompt !== undefined ? { negativePrompt: content.negativePrompt } : {}),
    ...(patch.genMode !== undefined ? { genMode: content.genMode } : {}),
  })

  for (const target of findAiTargetsForPrompt(promptNodeId, store.nodes, store.edges)) {
    fillAiFromPrompt(target.id, content)
  }
}

function endsArePromptAndAi(nodes: SuqNode[], connection: { source?: string | null; target?: string | null }): {
  promptId: string
  aiId: string
} | null {
  if (!connection.source || !connection.target) return null
  const source = nodeById(nodes, connection.source)
  const target = nodeById(nodes, connection.target)
  if (isPromptNode(source) && isAiImageNode(target)) {
    return { promptId: source!.id, aiId: target!.id }
  }
  if (isPromptNode(target) && isAiImageNode(source)) {
    return { promptId: target!.id, aiId: source!.id }
  }
  return null
}

/** 连线建立后：若一端是提示词、一端是 AI 图片，则自动填充草稿 */
export function applyPromptConnection(connection: Connection): void {
  const store = useCanvasStore.getState()
  const pair = endsArePromptAndAi(store.nodes, connection)
  if (!pair) return
  const promptNode = nodeById(store.nodes, pair.promptId)
  if (!promptNode) return
  fillAiFromPrompt(pair.aiId, readPromptContent(promptNode))
}
