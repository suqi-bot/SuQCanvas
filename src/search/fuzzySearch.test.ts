import { describe, expect, it } from 'vitest'
import type { SuqNode } from '../types'
import { fuzzyScore, searchCanvasNodes } from './fuzzySearch'

function node(id: string, label: string, text?: string): SuqNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label, text },
  }
}

describe('fuzzy search', () => {
  it('matches non-contiguous characters', () => {
    expect(fuzzyScore('quarterly-report-final.psd', 'qrf')).not.toBeNull()
    expect(fuzzyScore('quarterly-report-final.psd', 'xyz')).toBeNull()
  })

  it('ranks exact and prefix matches before loose matches', () => {
    const results = searchCanvasNodes(
      [node('loose', 'final-quarterly-report'), node('exact', 'report'), node('prefix', 'report-final')],
      'report',
    )
    expect(results.map((item) => item.id)).toEqual(['exact', 'prefix', 'loose'])
  })

  it('can match multiple terms across metadata fields', () => {
    const target = node('target', '设计稿.psd')
    target.data.createdByName = '小王'
    expect(searchCanvasNodes([target, node('other', '设计稿.psd')], '设计 小王')).toEqual([target])
  })
})

