import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { SuqNode } from '../types'
import { selectionHtml, selectionTextLines, isImageNode } from './clipboard'

function node(overrides: Partial<SuqNode['data']> & { id?: string } = {}): SuqNode {
  return {
    id: overrides.id ?? 'n1',
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', ...overrides },
  }
}

describe('系统剪贴板文字提取', () => {
  it('文本类节点只取 text，素材类节点取 label，忽略空内容', () => {
    const lines = selectionTextLines([
      node({ id: 'a', kind: 'text', text: '  你好  ', label: '编号A' }),
      node({ id: 'b', kind: 'heading', label: '标题 1' }),
      node({ id: 'c', kind: 'sticky', text: '   ', label: '便签' }),
      node({ id: 'd', kind: 'image', label: 'photo.png' }),
    ])
    expect(lines).toEqual(['你好', 'photo.png'])
  })

  it('生成转义后的 HTML 结构', () => {
    const html = selectionHtml([node({ text: 'a<b>&"', label: '忽略' })])
    expect(html).toBe('<div>a&lt;b&gt;&amp;&quot;</div>')
  })
})

describe('系统剪贴板图片节点判断', () => {
  it('仅 image 与 psd 视为图片节点', () => {
    expect(isImageNode(node({ kind: 'image' }))).toBe(true)
    expect(isImageNode(node({ kind: 'psd' }))).toBe(true)
    expect(isImageNode(node({ kind: 'text' }))).toBe(false)
    expect(isImageNode(node({ kind: 'file' }))).toBe(false)
  })
})
