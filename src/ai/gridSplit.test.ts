import { describe, expect, it } from 'vitest'
import { gridCells } from './gridSplit'

describe('grid crop coordinates', () => {
  it('covers odd image dimensions without missing or overlapping pixels', () => {
    const cells = gridCells(101, 79, 3, 2)
    expect(cells.reduce((sum, cell) => sum + cell.width * cell.height, 0)).toBe(101 * 79)
    expect(cells[0].x + cells[0].width).toBe(cells[1].x)
    expect(cells.at(-1)!.x + cells.at(-1)!.width).toBe(101)
    expect(cells.at(-1)!.y + cells.at(-1)!.height).toBe(79)
  })
  it('excludes gutters and outside margins', () => {
    expect(gridCells(110, 60, 1, 2, 10, 5)).toEqual([
      { row: 0, column: 0, x: 5, y: 5, width: 45, height: 50 },
      { row: 0, column: 1, x: 60, y: 5, width: 45, height: 50 },
    ])
  })
  it('rejects invalid, excessive, and zero-pixel grids', () => {
    for (const args of [[10, 10, 0, 2], [10, 10, 1.5, 2], [100, 100, 11, 10], [1, 1, 2, 2]]) {
      expect(() => gridCells(...args as [number, number, number, number])).toThrow()
    }
    expect(() => gridCells(10, 10, 2, 2, 10)).toThrow()
  })
})
