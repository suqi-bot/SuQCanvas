import { expect, it } from 'vitest'
import { composerPosition } from './composerPosition'

it('places the composer below an image when there is room', () => {
  expect(composerPosition({ x: 200, y: 100, width: 300, height: 200 }, { width: 460, height: 220 }, { width: 1200, height: 800 }, 40).top).toBe(340)
})
it('flips above an image near the bottom and clamps narrow screens', () => {
  const result = composerPosition({ x: 350, y: 600, width: 300, height: 100 }, { width: 460, height: 220 }, { width: 400, height: 740 }, 40)
  expect(result.top).toBe(368)
  expect(result.left).toBe(12)
  expect(result.width).toBe(376)
})
