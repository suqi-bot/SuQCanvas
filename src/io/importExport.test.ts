import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { exportProjectToBlob, importProjectFile } from './importExport'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import type { SuqEdge, SuqNode } from '../types'

function makeImageNode(id: string, assetId: string): SuqNode {
  return {
    id,
    type: 'image',
    position: { x: 100, y: 200 },
    style: { width: 240, height: 180 },
    data: {
      kind: 'image',
      assetId,
      label: 'test.png',
      fileSize: 4,
      mime: 'image/png',
      borderColor: '#64748b',
    },
  }
}

function makeTextNode(id: string): SuqNode {
  return {
    id,
    type: 'text',
    position: { x: 400, y: 300 },
    style: { width: 240 },
    data: { kind: 'text', label: '文本', text: '你好，世界', borderColor: '#64748b' },
  }
}

function makeEdge(id: string): SuqEdge {
  return {
    id,
    source: 'n1',
    target: 'n2',
    sourceHandle: 'right-source',
    targetHandle: 'left-target',
    type: 'styled',
    data: {
      style: {
        lineStyle: 'dashed',
        pathType: 'bezier',
        arrow: 'both',
        stroke: '#f472b6',
        strokeWidth: 3,
      },
    },
  }
}

describe('导出/导入往返', () => {
  beforeAll(async () => {
    await db.assets.clear()
    await db.projects.clear()
  })

  beforeEach(async () => {
    await db.assets.clear()
    await db.projects.clear()
    useCanvasStore.getState().reset()
    useProjectStore.setState({ projectId: null, projectName: '', loaded: false, saveStatus: 'idle' })
  })

  it('导出后再导入，图数据与媒体资产完整还原', async () => {
    await db.assets.add({
      id: 'a1',
      name: 'test.png',
      mime: 'image/png',
      size: 4,
      kind: 'image',
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    })

    const nodes = [makeImageNode('n1', 'a1'), makeTextNode('n2')]
    const edges = [makeEdge('e1')]
    const viewport = { x: 12, y: 34, zoom: 0.8 }

    const blob = await exportProjectToBlob('测试项目', nodes, edges, viewport)
    expect(blob.size).toBeGreaterThan(0)

    await db.assets.clear()
    await db.projects.clear()

    const file = new File([blob], 'test.sqcanvas', { type: 'application/zip' })
    await importProjectFile(file)

    const asset = await db.assets.get('a1')
    expect(asset).toBeDefined()
    expect(asset?.name).toBe('test.png')
    expect(asset?.mime).toBe('image/png')
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))

    const canvas = useCanvasStore.getState()
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.nodes.find((n) => n.id === 'n1')?.data.assetId).toBe('a1')
    expect(canvas.nodes.find((n) => n.id === 'n2')?.data.text).toBe('你好，世界')
    expect(canvas.edges[0].data.style.lineStyle).toBe('dashed')
    expect(canvas.edges[0].data.style.arrow).toBe('both')
    expect(canvas.viewport).toEqual(viewport)

    const project = await db.projects.orderBy('updatedAt').last()
    expect(project?.name).toBe('测试项目')
  })

  it('导入非项目文件时抛出错误', async () => {
    const junk = new File([new Uint8Array([1, 2, 3])], 'junk.bin', {
      type: 'application/octet-stream',
    })
    await expect(importProjectFile(junk)).rejects.toThrow()
  })

  it('无资产引用时导出不含 assets 目录', async () => {
    const blob = await exportProjectToBlob(
      '空项目',
      [makeTextNode('n1')],
      [],
      { x: 0, y: 0, zoom: 1 },
    )
    const file = new File([blob], 'empty.sqcanvas')
    await importProjectFile(file)
    expect(await db.assets.count()).toBe(0)
  })

  it('分组结构导出后导入完整还原（parentId/extent/isGroup 与命名）', async () => {
    const groupNode: SuqNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      style: { width: 400, height: 300 },
      zIndex: 0,
      // kind 仅为满足类型约束，对分组节点无意义
      data: { kind: 'text', isGroup: true, groupName: '分组A', label: '分组A' },
    }
    const childA: SuqNode = {
      id: 'c1',
      type: 'text',
      parentId: 'g1',
      extent: 'parent',
      position: { x: 20, y: 30 },
      style: { width: 160 },
      data: { kind: 'text', label: 'A', text: 'A', borderColor: '#64748b' },
    }
    const childB: SuqNode = {
      id: 'c2',
      type: 'text',
      parentId: 'g1',
      extent: 'parent',
      position: { x: 220, y: 180 },
      style: { width: 160 },
      data: { kind: 'text', label: 'B', text: 'B', borderColor: '#64748b' },
    }
    const nodes = [groupNode, childA, childB]
    const edges: SuqEdge[] = []
    const blob = await exportProjectToBlob('分组项目', nodes, edges, { x: 0, y: 0, zoom: 1 })
    const file = new File([blob], 'group.sqcanvas')
    await importProjectFile(file)

    const canvas = useCanvasStore.getState()
    expect(canvas.nodes).toHaveLength(3)

    const g = canvas.nodes.find((n) => n.id === 'g1')
    expect(g?.data.isGroup).toBe(true)
    expect(g?.data.groupName).toBe('分组A')
    expect(g?.type).toBe('group')

    const a = canvas.nodes.find((n) => n.id === 'c1')
    expect(a?.parentId).toBe('g1')
    expect(a?.extent).toBe('parent')

    // 导入归一化后父节点应排在子节点之前
    const order = canvas.nodes.map((n) => n.id)
    expect(order.indexOf('g1')).toBeLessThan(order.indexOf('c1'))
    expect(order.indexOf('g1')).toBeLessThan(order.indexOf('c2'))
  })
})
